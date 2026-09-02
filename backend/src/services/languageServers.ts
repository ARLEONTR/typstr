import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CompileDiagnostic } from '../types.js'
import type { ProjectWorkspace } from './projectWorkspace.js'
import { createMirroredWorkspace, resolveWorkspacePath, syncMirroredWorkspace } from './workspaceMirror.js'

type LspServerName = 'tinymist' | 'texlab'
type SupportedDocumentFormat = 'typst' | 'latex'

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type PublishDiagnosticsNotification = {
  uri: string
  diagnostics: Array<{
    range?: {
      start?: { line?: number; character?: number }
    }
    severity?: number
    message?: string
    source?: string
  }>
}

export interface LanguageToolServerStatus {
  name: LspServerName
  available: boolean
  running: boolean
  executable: string
  detail: string | null
}

export interface LanguageToolDiagnosticsResult {
  diagnostics: CompileDiagnostic[]
  statuses: LanguageToolServerStatus[]
  timings?: LanguageToolDiagnosticsTimings
}

export interface LanguageToolWarmSessionResult {
  statuses: LanguageToolServerStatus[]
  warmed: boolean
  timings?: LanguageToolDiagnosticsTimings
}

export interface LanguageToolDiagnosticsTimings {
  totalMs: number
  ensureStartedMs: number
  workspaceSyncMs: number
  lspUpdateMs: number
  waitForDiagnosticsMs: number
  cacheHit: boolean
  incremental: boolean
}

type MirroredWorkspaceSession = {
  dir: string
  lastTouchedAt: number
  revisionId: number
  lastDiagnosticsByPath: Map<string, { content: string; diagnostics: CompileDiagnostic[] }>
}

const mirroredWorkspaces = new Map<string, MirroredWorkspaceSession>()
const MIRRORED_WORKSPACE_TTL_MS = 15 * 60 * 1000

class LspProcess {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextRequestId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly documentVersions = new Map<string, number>()
  private readonly diagnosticsByUri = new Map<string, CompileDiagnostic[]>()
  private readonly diagnosticWaiters = new Map<string, Array<(value: CompileDiagnostic[]) => void>>()
  private initialized = false
  private lastError: string | null = null
  private readonly cwd = '/tmp'

  constructor(
    private readonly name: LspServerName,
    private readonly executable: string,
    private readonly args: string[],
    private readonly initializationOptions: Record<string, unknown> | undefined,
    private readonly configuration: Record<string, unknown> | undefined,
  ) {}

  status(): LanguageToolServerStatus {
    return {
      name: this.name,
      available: Boolean(this.executable),
      running: Boolean(this.proc && this.initialized),
      executable: this.executable,
      detail: this.lastError,
    }
  }

  async ensureStarted(): Promise<boolean> {
    if (!this.executable) {
      this.lastError = 'Executable is not configured.'
      return false
    }
    if (this.proc && this.initialized) {
      return true
    }

    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(this.executable, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.env.COMPILE_TMPDIR ?? '/tmp',
          env: {
            ...process.env,
            HOME: process.env.HOME ?? '/tmp',
          },
        })
        this.proc = proc
        this.buffer = ''
        this.initialized = false
        this.lastError = null

        proc.stdout.setEncoding('utf8')
        proc.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
        proc.stderr.setEncoding('utf8')
        proc.stderr.on('data', (chunk: string) => {
          const next = chunk.trim()
          if (next) {
            this.lastError = next
          }
        })
        proc.on('error', (error) => {
          this.lastError = error.message
          this.proc = null
          this.initialized = false
          resolve(false)
        })
        proc.on('exit', (code, signal) => {
          this.lastError = code === 0 ? null : `${this.name} exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}`
          this.proc = null
          this.initialized = false
        })

        void this.initialize().then(() => resolve(true)).catch((error: Error) => {
          this.lastError = error.message
          this.proc?.kill('SIGTERM')
          this.proc = null
          this.initialized = false
          resolve(false)
        })
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.proc = null
        this.initialized = false
        resolve(false)
      }
    })
  }

  async syncDocument(uri: string, languageId: string, text: string): Promise<void> {
    const started = await this.ensureStarted()
    if (!started) {
      return
    }

    const version = (this.documentVersions.get(uri) ?? 0) + 1
    this.documentVersions.set(uri, version)

    if (version === 1) {
      this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version,
          text,
        },
      })
      return
    }

    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri,
        version,
      },
      contentChanges: [{ text }],
    })
  }

  invalidateDiagnostics(uri: string): void {
    this.diagnosticsByUri.delete(uri)
  }

  async waitForDiagnostics(uri: string, timeoutMs = 1200): Promise<CompileDiagnostic[]> {
    const current = this.diagnosticsByUri.get(uri)
    if (current) {
      return current
    }

    return new Promise<CompileDiagnostic[]>((resolve) => {
      const timeout = setTimeout(() => {
        const waiters = this.diagnosticWaiters.get(uri) ?? []
        this.diagnosticWaiters.set(uri, waiters.filter((waiter) => waiter !== onDiagnostics))
        resolve(this.diagnosticsByUri.get(uri) ?? [])
      }, timeoutMs)

      const onDiagnostics = (diagnostics: CompileDiagnostic[]) => {
        clearTimeout(timeout)
        resolve(diagnostics)
      }

      const waiters = this.diagnosticWaiters.get(uri) ?? []
      waiters.push(onDiagnostics)
      this.diagnosticWaiters.set(uri, waiters)
    })
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      clientInfo: { name: 'typstr', version: '0.1' },
      rootUri: null,
      capabilities: {
        textDocument: {
          publishDiagnostics: {
            relatedInformation: false,
          },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
      },
      initializationOptions: this.initializationOptions,
    })

    if (!result) {
      throw new Error(`Failed to initialize ${this.name}`)
    }

    this.sendNotification('initialized', {})
    if (this.configuration) {
      this.sendNotification('workspace/didChangeConfiguration', { settings: this.configuration })
    }
    this.initialized = true
  }

  private sendNotification(method: string, params: unknown): void {
    this.writeMessage({ jsonrpc: '2.0', method, params })
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId += 1
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.writeMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  private writeMessage(payload: JsonRpcRequest): void {
    if (!this.proc) {
      throw new Error(`${this.name} is not running`)
    }

    const body = JSON.stringify(payload)
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const header = this.buffer.slice(0, headerEnd)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = Number(lengthMatch[1])
      const totalLength = headerEnd + 4 + contentLength
      if (this.buffer.length < totalLength) {
        return
      }

      const body = this.buffer.slice(headerEnd + 4, totalLength)
      this.buffer = this.buffer.slice(totalLength)

      try {
        const message = JSON.parse(body) as JsonRpcRequest
        this.handleMessage(message)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
  }

  private handleMessage(message: JsonRpcRequest): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method === 'textDocument/publishDiagnostics' && message.params) {
      const payload = message.params as PublishDiagnosticsNotification
      const diagnostics = (payload.diagnostics ?? []).map((diagnostic) => ({
        level: diagnostic.severity === 2 ? 'warning' as const : 'error' as const,
        message: diagnostic.message ?? 'Language server diagnostic',
        filePath: payload.uri.startsWith('file:') ? fileUriToPath(payload.uri) : payload.uri,
        line: typeof diagnostic.range?.start?.line === 'number' ? diagnostic.range.start.line + 1 : null,
        column: typeof diagnostic.range?.start?.character === 'number' ? diagnostic.range.start.character + 1 : null,
        raw: `${diagnostic.source ? `${diagnostic.source}: ` : ''}${diagnostic.message ?? 'Language server diagnostic'}`,
      }))
      this.diagnosticsByUri.set(payload.uri, diagnostics)
      const waiters = this.diagnosticWaiters.get(payload.uri) ?? []
      this.diagnosticWaiters.delete(payload.uri)
      for (const waiter of waiters) {
        waiter(diagnostics)
      }
    }
  }
}

const tinymistExecutable = process.env.TINYMIST_BIN ?? 'tinymist'
const texlabExecutable = process.env.TEXLAB_BIN ?? 'texlab'

const tinymistServer = new LspProcess(
  'tinymist',
  tinymistExecutable,
  ['lsp'],
  undefined,
  {
    tinymist: {
      preview: {
        partialRendering: true,
        refresh: 'onType',
        scrollSync: 'onSelectionChange',
      },
    },
  },
)

const texlabServer = new LspProcess(
  'texlab',
  texlabExecutable,
  [],
  undefined,
  {
    texlab: {
      diagnosticsDelay: 250,
      build: {
        onSave: false,
      },
      completion: {
        matcher: 'fuzzy-ignore-case',
      },
      chktex: {
        onEdit: false,
        onOpenAndSave: false,
      },
    },
  },
)

export async function collectLanguageDiagnostics(input: {
  format: SupportedDocumentFormat
  workspace: ProjectWorkspace
  activeFilePath: string
  workspaceKey: string
}): Promise<LanguageToolDiagnosticsResult> {
  const server = input.format === 'latex' ? texlabServer : tinymistServer
  const startedAt = Date.now()
  const ensureStartedAt = startedAt
  const started = await server.ensureStarted()
  const ensureStartedMs = Date.now() - ensureStartedAt
  if (!started) {
    return {
      diagnostics: [],
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs: 0,
        lspUpdateMs: 0,
        waitForDiagnosticsMs: 0,
        cacheHit: false,
        incremental: false,
      },
    }
  }

  cleanupExpiredMirroredWorkspaces()
  const workspaceSyncAt = Date.now()
  const mirrored = getOrCreateMirroredWorkspace(input.workspaceKey, input.workspace, input.format, input.workspace.revisionId)
  const workspaceSyncMs = Date.now() - workspaceSyncAt
  try {
    const activeFileAbsolutePath = mirrored.resolvePath(input.activeFilePath)
    if (!existsSync(activeFileAbsolutePath)) {
      return { diagnostics: [], statuses: [tinymistServer.status(), texlabServer.status()] }
    }

    const activeFile = input.workspace.files.find((file) => normalizeRelativePath(file.path) === normalizeRelativePath(input.activeFilePath))
    if (!activeFile || typeof activeFile.content !== 'string') {
      return { diagnostics: [], statuses: [tinymistServer.status(), texlabServer.status()] }
    }

    const uri = pathToFileURL(activeFileAbsolutePath).href
    server.invalidateDiagnostics(uri)
    const lspUpdateAt = Date.now()
    await server.syncDocument(uri, input.format === 'latex' ? 'latex' : 'typst', activeFile.content)
    const lspUpdateMs = Date.now() - lspUpdateAt
    const waitForDiagnosticsAt = Date.now()
    const diagnostics = await server.waitForDiagnostics(uri)
    const waitForDiagnosticsMs = Date.now() - waitForDiagnosticsAt
    const existingSession = mirroredWorkspaces.get(input.workspaceKey)
    existingSession?.lastDiagnosticsByPath.set(normalizeRelativePath(input.activeFilePath), {
      content: activeFile.content,
      diagnostics,
    })

    return {
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        filePath: diagnostic.filePath ? path.relative(mirrored.dir, diagnostic.filePath) : input.activeFilePath,
      })),
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs,
        lspUpdateMs,
        waitForDiagnosticsMs,
        cacheHit: false,
        incremental: false,
      },
    }
  } finally {
    const existing = mirroredWorkspaces.get(input.workspaceKey)
    if (existing) {
      existing.lastTouchedAt = Date.now()
    }
  }
}

export async function collectIncrementalLanguageDiagnostics(input: {
  format: SupportedDocumentFormat
  activeFilePath: string
  activeFileContent: string
  workspaceKey: string
  workspaceRevisionId: number
}): Promise<LanguageToolDiagnosticsResult | null> {
  const server = input.format === 'latex' ? texlabServer : tinymistServer
  const startedAt = Date.now()
  const ensureStartedAt = startedAt
  const started = await server.ensureStarted()
  const ensureStartedMs = Date.now() - ensureStartedAt
  if (!started) {
    return {
      diagnostics: [],
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs: 0,
        lspUpdateMs: 0,
        waitForDiagnosticsMs: 0,
        cacheHit: false,
        incremental: true,
      },
    }
  }

  cleanupExpiredMirroredWorkspaces()
  const mirrored = mirroredWorkspaces.get(input.workspaceKey)
  if (!mirrored || mirrored.revisionId !== input.workspaceRevisionId) {
    return null
  }

  try {
    const normalizedPath = normalizeRelativePath(input.activeFilePath)
    const cached = mirrored.lastDiagnosticsByPath.get(normalizedPath)
    if (cached && cached.content === input.activeFileContent) {
      mirrored.lastTouchedAt = Date.now()
      return {
        diagnostics: cached.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          filePath: diagnostic.filePath ? path.relative(mirrored.dir, diagnostic.filePath) : input.activeFilePath,
        })),
        statuses: [tinymistServer.status(), texlabServer.status()],
        timings: {
          totalMs: Date.now() - startedAt,
          ensureStartedMs,
          workspaceSyncMs: 0,
          lspUpdateMs: 0,
          waitForDiagnosticsMs: 0,
          cacheHit: true,
          incremental: true,
        },
      }
    }

    const workspaceSyncAt = Date.now()
    const activeFileAbsolutePath = resolveWorkspacePath(mirrored.dir, input.activeFilePath)
    writeFileSync(activeFileAbsolutePath, input.activeFileContent, 'utf8')
    const workspaceSyncMs = Date.now() - workspaceSyncAt
    const uri = pathToFileURL(activeFileAbsolutePath).href
    server.invalidateDiagnostics(uri)
    const lspUpdateAt = Date.now()
    await server.syncDocument(uri, input.format === 'latex' ? 'latex' : 'typst', input.activeFileContent)
    const lspUpdateMs = Date.now() - lspUpdateAt
    const waitForDiagnosticsAt = Date.now()
    const diagnostics = await server.waitForDiagnostics(uri)
    const waitForDiagnosticsMs = Date.now() - waitForDiagnosticsAt

    mirrored.lastTouchedAt = Date.now()
    mirrored.lastDiagnosticsByPath.set(normalizedPath, {
      content: input.activeFileContent,
      diagnostics,
    })

    return {
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        filePath: diagnostic.filePath ? path.relative(mirrored.dir, diagnostic.filePath) : input.activeFilePath,
      })),
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs,
        lspUpdateMs,
        waitForDiagnosticsMs,
        cacheHit: false,
        incremental: true,
      },
    }
  } catch {
    mirroredWorkspaces.delete(input.workspaceKey)
    return null
  }
}

export function hasIncrementalLanguageDiagnosticsSession(workspaceKey: string, workspaceRevisionId: number): boolean {
  const mirrored = mirroredWorkspaces.get(workspaceKey)
  return Boolean(mirrored && mirrored.revisionId === workspaceRevisionId)
}

export async function warmLanguageDiagnosticsSession(input: {
  format: SupportedDocumentFormat
  workspace: ProjectWorkspace
  activeFilePath: string
  workspaceKey: string
}): Promise<LanguageToolWarmSessionResult> {
  const server = input.format === 'latex' ? texlabServer : tinymistServer
  const startedAt = Date.now()
  const ensureStartedAt = startedAt
  const started = await server.ensureStarted()
  const ensureStartedMs = Date.now() - ensureStartedAt
  if (!started) {
    return {
      warmed: false,
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs: 0,
        lspUpdateMs: 0,
        waitForDiagnosticsMs: 0,
        cacheHit: false,
        incremental: false,
      },
    }
  }

  cleanupExpiredMirroredWorkspaces()
  const workspaceSyncAt = Date.now()
  const mirrored = getOrCreateMirroredWorkspace(input.workspaceKey, input.workspace, input.format, input.workspace.revisionId)
  const workspaceSyncMs = Date.now() - workspaceSyncAt
  try {
    const activeFileAbsolutePath = mirrored.resolvePath(input.activeFilePath)
    if (!existsSync(activeFileAbsolutePath)) {
      return {
        warmed: false,
        statuses: [tinymistServer.status(), texlabServer.status()],
        timings: {
          totalMs: Date.now() - startedAt,
          ensureStartedMs,
          workspaceSyncMs,
          lspUpdateMs: 0,
          waitForDiagnosticsMs: 0,
          cacheHit: false,
          incremental: false,
        },
      }
    }

    const activeFile = input.workspace.files.find((file) => normalizeRelativePath(file.path) === normalizeRelativePath(input.activeFilePath))
    if (!activeFile || typeof activeFile.content !== 'string') {
      return {
        warmed: false,
        statuses: [tinymistServer.status(), texlabServer.status()],
        timings: {
          totalMs: Date.now() - startedAt,
          ensureStartedMs,
          workspaceSyncMs,
          lspUpdateMs: 0,
          waitForDiagnosticsMs: 0,
          cacheHit: false,
          incremental: false,
        },
      }
    }

    const uri = pathToFileURL(activeFileAbsolutePath).href
    server.invalidateDiagnostics(uri)
    const lspUpdateAt = Date.now()
    await server.syncDocument(uri, input.format === 'latex' ? 'latex' : 'typst', activeFile.content)
    const lspUpdateMs = Date.now() - lspUpdateAt

    return {
      warmed: true,
      statuses: [tinymistServer.status(), texlabServer.status()],
      timings: {
        totalMs: Date.now() - startedAt,
        ensureStartedMs,
        workspaceSyncMs,
        lspUpdateMs,
        waitForDiagnosticsMs: 0,
        cacheHit: false,
        incremental: false,
      },
    }
  } finally {
    const existing = mirroredWorkspaces.get(input.workspaceKey)
    if (existing) {
      existing.lastTouchedAt = Date.now()
    }
  }
}

export function getLanguageServerStatuses(): LanguageToolServerStatus[] {
  return [tinymistServer.status(), texlabServer.status()]
}

function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri
  }

  return decodeURIComponent(uri.replace('file://', ''))
}

function normalizeRelativePath(filePath: string): string {
  return path.posix.normalize(filePath).replace(/^\/+/, '')
}

function getOrCreateMirroredWorkspace(workspaceKey: string, workspace: ProjectWorkspace, format: SupportedDocumentFormat, revisionId: number) {
  const existing = mirroredWorkspaces.get(workspaceKey)
  if (existing && existing.revisionId === revisionId) {
    syncMirroredWorkspace(existing.dir, workspace.files)
    existing.lastTouchedAt = Date.now()
    return {
      dir: existing.dir,
      resolvePath: (relativePath: string) => resolveWorkspacePath(existing.dir, relativePath),
    }
  }

  if (existing) {
    rmSync(existing.dir, { recursive: true, force: true })
    mirroredWorkspaces.delete(workspaceKey)
  }

  const created = createMirroredWorkspace(workspace, `typstr-lsp-${format}-`)
  mirroredWorkspaces.set(workspaceKey, {
    dir: created.dir,
    lastTouchedAt: Date.now(),
    revisionId,
    lastDiagnosticsByPath: new Map(),
  })
  return {
    dir: created.dir,
    resolvePath: created.resolvePath,
  }
}

function cleanupExpiredMirroredWorkspaces(): void {
  const cutoff = Date.now() - MIRRORED_WORKSPACE_TTL_MS
  for (const [workspaceKey, workspace] of mirroredWorkspaces) {
    if (workspace.lastTouchedAt >= cutoff) {
      continue
    }
    rmSync(workspace.dir, { recursive: true, force: true })
    mirroredWorkspaces.delete(workspaceKey)
  }
}
