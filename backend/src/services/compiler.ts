import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import os from 'node:os'
import { gunzipSync } from 'node:zlib'
import pLimit from 'p-limit'
import type { CompileDiagnostic } from '../types.js'
import { fontPathsFromWorkspace } from './ecosystem.js'
import { env } from '../env.js'


const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_COMPILES ?? '0') || Math.max(2, os.cpus().length)
const limit = pLimit(MAX_CONCURRENT)
const COMPILE_CACHE_TTL_MS = 10_000
const COMPILE_CACHE_MAX_ENTRIES = parseInt(process.env.COMPILE_CACHE_MAX_ENTRIES ?? '0', 10) || 100
const svgCompileCache = new Map<string, { expiresAt: number; result: CompileResult }>()
const svgCompileInflight = new Map<string, Promise<CompileResult>>()

const LATEX_COMPILE_CACHE_TTL_MS = 30_000
const LATEX_COMPILE_CACHE_MAX_ENTRIES = 50
const latexCompileCache = new Map<string, { expiresAt: number; result: CompileLatexResult }>()
const latexCompileInflight = new Map<string, Promise<CompileLatexResult>>()

// Cache SHA256 hashes for Buffer objects by reference — avoids re-hashing
// binary assets (fonts, images) that haven't changed between compiles.
const bufferHashCache = new WeakMap<Buffer, string>()

function getBaseCompileDir(): string {
  if (env.compileTmpdir) {
    try {
      mkdirSync(env.compileTmpdir, { recursive: true })
      return env.compileTmpdir
    } catch {}
  }
  return tmpdir()
}

function getTypstPackageCacheArgs(): string[] {
  const cacheDir = process.env.TYPST_PACKAGE_CACHE_PATH
    || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'typst')

  try {
    mkdirSync(cacheDir, { recursive: true })
    return ['--package-cache-path', cacheDir]
  } catch {
    return []
  }
}

function cacheSvgCompileResult(cacheKey: string, result: CompileResult): void {
  const now = Date.now()
  for (const [key, entry] of svgCompileCache) {
    if (entry.expiresAt <= now) {
      svgCompileCache.delete(key)
    }
  }

  svgCompileCache.set(cacheKey, { expiresAt: now + COMPILE_CACHE_TTL_MS, result })
  while (svgCompileCache.size > COMPILE_CACHE_MAX_ENTRIES) {
    const oldestKey = svgCompileCache.keys().next().value
    if (!oldestKey) break
    svgCompileCache.delete(oldestKey)
  }
}

function cacheLatexCompileResult(cacheKey: string, result: CompileLatexResult): void {
  const now = Date.now()
  for (const [key, entry] of latexCompileCache) {
    if (entry.expiresAt <= now) {
      latexCompileCache.delete(key)
    }
  }

  latexCompileCache.set(cacheKey, { expiresAt: now + LATEX_COMPILE_CACHE_TTL_MS, result })
  while (latexCompileCache.size > LATEX_COMPILE_CACHE_MAX_ENTRIES) {
    const oldestKey = latexCompileCache.keys().next().value
    if (!oldestKey) break
    latexCompileCache.delete(oldestKey)
  }
}

function getLatexCompileCacheKey(input: {
  entryPath: string
  files: CompileWorkspaceFile[]
  engine?: LatexEngine
}): string {
  const hash = createHash('sha256')
  hash.update(input.entryPath)
  hash.update(input.engine ?? 'auto')
  const sortedFiles = [...input.files].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of sortedFiles) {
    hash.update(file.path)
    if (typeof file.content === 'string') {
      hash.update(file.content)
    } else {
      let bufHash = bufferHashCache.get(file.content)
      if (!bufHash) {
        bufHash = createHash('sha256').update(file.content).digest('hex')
        bufferHashCache.set(file.content, bufHash)
      }
      hash.update(bufHash)
    }
  }
  return hash.digest('hex')
}

function detectLatexEngine(files: CompileWorkspaceFile[], entryPath: string): LatexEngine {
  const normalizedEntryPath = normalizeDependencyPath(entryPath)
  const entryFile = files.find((file) => normalizeDependencyPath(file.path) === normalizedEntryPath)
  if (entryFile && typeof entryFile.content === 'string') {
    if (/\\usepackage(\[[^\]]*\])?\{(fontspec|polyglossia|unicode-math)\}/i.test(entryFile.content)) {
      return 'xelatex'
    }
    if (/\\usepackage(\[[^\]]*\])?\{luacode\}/i.test(entryFile.content)) {
      return 'lualatex'
    }
  }
  return 'pdflatex'
}

export interface CompileTimings {
  workspaceWriteMs: number
  typstProcessMs: number
  svgReadMs: number
  totalMs: number
}

interface PersistentWorkspaceState {
  dir: string
  fileContentRefs: Map<string, string | Buffer>
  lastUsedAt: number
}

const persistentWorkspaces = new Map<string, PersistentWorkspaceState>()
const WORKSPACE_TTL_MS = 10 * 60 * 1_000

setInterval(() => {
  const now = Date.now()
  for (const [sessionId, state] of persistentWorkspaces) {
    if (now - state.lastUsedAt > WORKSPACE_TTL_MS) {
      rmSync(state.dir, { recursive: true, force: true })
      persistentWorkspaces.delete(sessionId)
    }
  }
}, 5 * 60 * 1_000).unref()

export function cleanupPersistentWorkspace(previewSessionId: string): void {
  const state = persistentWorkspaces.get(previewSessionId)
  if (state) {
    rmSync(state.dir, { recursive: true, force: true })
    persistentWorkspaces.delete(previewSessionId)
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

export interface CompileResult {
  pages: string[]  // SVG strings, one per page
  diagnostics: CompileDiagnostic[]
}

export interface CompileWorkspaceFile {
  path: string
  content: string | Buffer
  mimeType?: string
}

export interface CompileExecutionOptions {
  previewSessionId?: string
  signal?: AbortSignal
  projectId?: string
  timeoutMs?: number
}

export type LatexEngine = 'pdflatex' | 'xelatex' | 'lualatex'

export type LatexSyncTexEntry = {
  filePath: string
  line: number
  column: number | null
  page: number
  x: number
  y: number
  width: number | null
  height: number | null
}

type DependencyReference = {
  sourcePath: string
  targetPath: string
}

export async function compileTypstToSvg(source: string): Promise<CompileResult> {
  return compileTypstProjectToSvg({
    entryPath: 'input.typ',
    files: [{ path: 'input.typ', content: source }],
  })
}

export async function compileTypstProjectToSvg(input: {
  entryPath: string
  files: CompileWorkspaceFile[]
}, options: CompileExecutionOptions = {}): Promise<CompileResult> {
  const cacheKey = getCompileCacheKey(input)
  const shareInflight = !options.signal
  const cached = svgCompileCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  if (shareInflight) {
    const inflight = svgCompileInflight.get(cacheKey)
    if (inflight) {
      return inflight
    }
  }

  const signal = options.signal
  const previewSessionId = options.previewSessionId
  const t0 = Date.now()

  const job = limit(() => new Promise<CompileResult>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Compile cancelled'))
    }

    let workDir: string
    let isPersistent = false
    const tWrite0 = Date.now()

    if (previewSessionId) {
      let state = persistentWorkspaces.get(previewSessionId)
      if (!state) {
        const dir = mkdtempSync(path.join(getBaseCompileDir(), 'typstr-ws-'))
        state = { dir, fileContentRefs: new Map(), lastUsedAt: Date.now() }
        persistentWorkspaces.set(previewSessionId, state)
      } else {
        state.lastUsedAt = Date.now()
      }
      updatePersistentWorkspace(state, input.files)
      clearSvgOutputs(state.dir)
      workDir = state.dir
      isPersistent = true
    } else {
      workDir = mkdtempSync(path.join(getBaseCompileDir(), 'typstr-'))
      writeWorkspaceFiles(workDir, input.files)
    }
    const workspaceWriteMs = Date.now() - tWrite0

    const inputFile = resolveWorkspacePath(workDir, input.entryPath)
    const outputPattern = path.join(workDir, 'output-{p}.svg')
    const fontPathArgs = fontPathsFromWorkspace(input.files).flatMap((fontPath) => ['--font-path', resolveWorkspacePath(workDir, fontPath || '.')])
    const cachePathArgs = getTypstPackageCacheArgs()

    const errChunks: Buffer[] = []
    const timeoutMs = options.timeoutMs ?? parseInt(process.env.TYPST_COMPILE_TIMEOUT_MS ?? '60000', 10)

    const proc = spawn(
      'typst',
      ['compile', inputFile, outputPattern, '--root', workDir, '--format', 'svg', ...fontPathArgs, ...cachePathArgs],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      }
    )

    proc.stderr.on('data', (chunk: Buffer) => {
      console.error(`[Typst SVG Compiler Stderr]: ${chunk.toString()}`)
      errChunks.push(chunk)
    })

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      if (!isPersistent) rmSync(workDir, { recursive: true, force: true })
      reject(new Error(`Typst compilation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timeout)
      proc.kill('SIGTERM')
      if (!isPersistent) rmSync(workDir, { recursive: true, force: true })
      reject(new Error('Compile cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (!isPersistent) rmSync(workDir, { recursive: true, force: true })
      reject(new Error(`Failed to start typst: ${err.message}. Is typst installed?`))
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      try {
        if (signal?.aborted) {
          reject(new Error('Compile cancelled'))
          return
        }

        const typstProcessMs = Date.now() - tWrite0 - workspaceWriteMs
        const errOutput = stripAnsi(Buffer.concat(errChunks).toString('utf8'))
        const diagnostics = parseCompileDiagnostics(errOutput, input.entryPath)

        const tRead0 = Date.now()
        const svgFiles = readdirSync(workDir)
          .filter((f) => f.startsWith('output-') && f.endsWith('.svg'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10)
            const numB = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10)
            return numA - numB
          })
        const pages = svgFiles.map((f) => readFileSync(path.join(workDir, f), 'utf8'))
        const svgReadMs = Date.now() - tRead0

        console.info('[compile:svg] entry=%s files=%d pages=%d write=%dms typst=%dms read=%dms total=%dms',
          input.entryPath, input.files.length, pages.length,
          workspaceWriteMs, typstProcessMs, svgReadMs, Date.now() - t0)

        if (code !== 0 && pages.length === 0) {
          const fallbackMsg = errOutput.trim() || `typst exited with code ${code}`
          const errorDiagnostics = diagnostics.length > 0 ? diagnostics : [{ level: 'error' as const, message: fallbackMsg, filePath: null, line: null, column: null, raw: fallbackMsg }]
          resolve({ pages: [], diagnostics: errorDiagnostics })
        } else {
          const result = { pages, diagnostics }
          cacheSvgCompileResult(cacheKey, result)
          resolve(result)
        }
      } finally {
        if (!isPersistent) rmSync(workDir, { recursive: true, force: true })
      }
    })
  }))

  if (shareInflight) {
    svgCompileInflight.set(cacheKey, job)
  }
  try {
    return await job
  } finally {
    if (shareInflight) {
      svgCompileInflight.delete(cacheKey)
    }
  }
}

export async function compileTypstProjectToPdf(input: {
  entryPath: string
  files: CompileWorkspaceFile[]
}, options: CompileExecutionOptions = {}): Promise<Buffer> {
  const signal = options.signal

  return limit(() => new Promise<Buffer>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Compile cancelled'))
    }

    const tmpDir = mkdtempSync(path.join(getBaseCompileDir(), 'typstr-pdf-'))

    try {
      writeWorkspaceFiles(tmpDir, input.files)

      const inputFile = resolveWorkspacePath(tmpDir, input.entryPath)
      const outputFile = path.join(tmpDir, 'output.pdf')
      const fontPathArgs = fontPathsFromWorkspace(input.files).flatMap((fontPath) => ['--font-path', resolveWorkspacePath(tmpDir, fontPath || '.')])
      const cachePathArgs = getTypstPackageCacheArgs()
      const errChunks: Buffer[] = []
      const timeoutMs = options.timeoutMs ?? parseInt(process.env.TYPST_COMPILE_TIMEOUT_MS ?? '60000', 10)

      const proc = spawn(
        'typst',
        ['compile', inputFile, outputFile, '--root', tmpDir, '--format', 'pdf', ...fontPathArgs, ...cachePathArgs],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        }
      )

      proc.stderr.on('data', (chunk: Buffer) => {
        console.error(`[Typst PDF Compiler Stderr]: ${chunk.toString()}`)
        errChunks.push(chunk)
      })

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        rmSync(tmpDir, { recursive: true, force: true })
        reject(new Error(`Typst compilation timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const onAbort = () => {
        clearTimeout(timeout)
        proc.kill('SIGTERM')
        rmSync(tmpDir, { recursive: true, force: true })
        reject(new Error('Compile cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        rmSync(tmpDir, { recursive: true, force: true })
        reject(new Error(`Failed to start typst: ${err.message}. Is typst installed?`))
      })

      proc.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        clearTimeout(timeout)
        try {
          if (signal?.aborted) {
            reject(new Error('Compile cancelled'))
            return
          }

          if (code === 0) {
            resolve(readFileSync(outputFile))
          } else {
            const errMsg = stripAnsi(Buffer.concat(errChunks).toString('utf8')).trim()
            reject(new Error(errMsg || `typst exited with code ${code}`))
          }
        } finally {
          rmSync(tmpDir, { recursive: true, force: true })
        }
      })
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true })
      reject(err)
    }
  }))
}

export interface CompileLatexResult {
  pdf: Buffer
  log: string
  engine: LatexEngine
  syncTex: LatexSyncTexEntry[]
  syncTexRaw?: Buffer
}

export async function compileLatexProjectToPdf(input: {
  entryPath: string
  files: CompileWorkspaceFile[]
  engine?: LatexEngine
}, options: CompileExecutionOptions = {}): Promise<CompileLatexResult> {
  const preferredEngine = input.engine ?? detectLatexEngine(input.files, input.entryPath)
  const cacheKey = getLatexCompileCacheKey({ ...input, engine: preferredEngine })
  const shareInflight = !options.signal
  const cached = latexCompileCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  if (shareInflight) {
    const inflight = latexCompileInflight.get(cacheKey)
    if (inflight) {
      return inflight
    }
  }

  const signal = options.signal
  const engineOrder = getLatexEngineOrder(preferredEngine)

  const job = limit(() => new Promise<CompileLatexResult>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Compile cancelled'))
    }

    const tmpDir = mkdtempSync(path.join(getBaseCompileDir(), 'typstr-latex-'))
    try {
      writeWorkspaceFiles(tmpDir, input.files)
      const inputFile = resolveWorkspacePath(tmpDir, input.entryPath)
      const latexWorkDir = path.dirname(inputFile)
      const inputFileName = path.basename(inputFile)
      const outputFile = path.join(latexWorkDir, inputFileName.replace(/\.[^.]+$/, '') + '.pdf')
      const syncTexFile = path.join(latexWorkDir, inputFileName.replace(/\.[^.]+$/, '') + '.synctex.gz')
      const timeoutMs = options.timeoutMs ?? parseInt(process.env.TYPST_COMPILE_TIMEOUT_MS ?? '60000', 10)
      const deadline = Date.now() + timeoutMs

      let finished = false
      const logs: string[] = []
      const errors: string[] = []
      let onAbort: () => void = () => undefined

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        rmSync(tmpDir, { recursive: true, force: true })
      }

      onAbort = () => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error('Compile cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const fail = (message: string) => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error(message))
      }

      const succeed = (pdf: Buffer, log: string, engine: LatexEngine) => {
        if (finished) return
        finished = true
        const syncTex = parseLatexSyncTexFile(syncTexFile, latexWorkDir)
        let syncTexRaw: Buffer | undefined
        try {
          if (pathExists(syncTexFile)) {
            syncTexRaw = readFileSync(syncTexFile)
          }
        } catch {
          syncTexRaw = undefined
        }
        cleanup()
        const compileResult: CompileLatexResult = { pdf, log, engine, syncTex, syncTexRaw }
        cacheLatexCompileResult(cacheKey, compileResult)
        resolve(compileResult)
      }

      const runLatexWithBudget = (bin: string, args: string[]) => {
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) {
          return Promise.reject(new Error(`LaTeX compilation timed out after ${timeoutMs}ms`))
        }

        return runLatexCommand(bin, args, latexWorkDir, signal, remainingMs)
      }

      const runEngineAt = (index: number) => {
        if (finished) {
          return
        }

        if (signal?.aborted) {
          fail('Compile cancelled')
          return
        }

        if (Date.now() >= deadline) {
          fail(`LaTeX compilation timed out after ${timeoutMs}ms`)
          return
        }

        const engine = engineOrder[index]
        if (!engine) {
          const combinedLog = logs.join('\n\n').trim()
          const combinedErrors = errors.join('\n').trim()
          fail(combinedLog || combinedErrors || 'LaTeX compilation failed.')
          return
        }

        const runLabel = `${engine} main pass`
        const latexArgs = ['--interaction=nonstopmode', '-no-shell-escape', '-file-line-error', '-synctex=1', inputFileName]

        runLatexWithBudget(engine, latexArgs).then((result) => {
          logs.push(`$ ${runLabel}\n${result.log}`)
          const mainAux = path.join(latexWorkDir, inputFileName.replace(/\.[^.]+$/, '.aux'))
          const jobName = inputFileName.replace(/\.[^.]+$/, '')
          const bibliographyCommand = selectBibliographyCommand(input.files, input.entryPath)
          if (result.exitCode !== 0) {
            errors.push(result.log || `${engine} exited with code ${result.exitCode}`)
            if (!pathExists(outputFile)) {
              runEngineAt(index + 1)
              return
            }
          }

          if (
            result.exitCode === 0
            && bibliographyCommand === null
            && pathExists(outputFile)
            && !latexLogNeedsRerun(result.log)
          ) {
            succeed(readFileSync(outputFile), logs.join('\n\n').trim(), engine)
            return
          }

          const continueAfterBib = () => {
            runLatexWithBudget(engine, latexArgs).then((secondPass) => {
              logs.push(`$ ${engine} final pass\n${secondPass.log}`)
              if (secondPass.exitCode !== 0) {
                errors.push(secondPass.log || `${engine} final pass exited with code ${secondPass.exitCode}`)
              }

              if (!pathExists(outputFile)) {
                errors.push('LaTeX completed without producing a PDF output file.')
                runEngineAt(index + 1)
                return
              }
              succeed(readFileSync(outputFile), logs.join('\n\n').trim(), engine)
            }).catch((err) => {
              const message = String(err instanceof Error ? err.message : err)
              errors.push(message)
              if (isCompileControlErrorMessage(message)) {
                fail(message)
                return
              }
              runEngineAt(index + 1)
            })
          }

          if (bibliographyCommand === null || !pathExists(mainAux)) {
            continueAfterBib()
            return
          }

          runLatexWithBudget(bibliographyCommand.command, [...bibliographyCommand.args, jobName]).then((bibResult) => {
            logs.push(`$ ${bibliographyCommand.command} ${bibliographyCommand.args.join(' ')} ${jobName}\n${bibResult.log}`)
            if (bibResult.exitCode !== 0) {
              errors.push(bibResult.log || `${bibliographyCommand.command} exited with code ${bibResult.exitCode}`)
            }
            continueAfterBib()
          }).catch((err) => {
            const message = String(err instanceof Error ? err.message : err)
            errors.push(message)
            if (isCompileControlErrorMessage(message)) {
              fail(message)
              return
            }
            continueAfterBib()
          })
        }).catch((err) => {
          const message = String(err instanceof Error ? err.message : err)
          errors.push(message)
          if (isCompileControlErrorMessage(message)) {
            fail(message)
            return
          }
          runEngineAt(index + 1)
        })
      }

      runEngineAt(0)
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true })
      reject(err)
    }
  }))

  if (shareInflight) {
    latexCompileInflight.set(cacheKey, job)
  }
  try {
    return await job
  } finally {
    if (shareInflight) {
      latexCompileInflight.delete(cacheKey)
    }
  }
}

function getLatexEngineOrder(preferred: LatexEngine): LatexEngine[] {
  return [preferred]
}

function parseLatexSyncTexFile(filePath: string, workDir: string): LatexSyncTexEntry[] {
  if (!pathExists(filePath)) {
    return []
  }

  try {
    const raw = gunzipSync(readFileSync(filePath)).toString('utf8')
    return parseLatexSyncTex(raw, workDir)
  } catch {
    return []
  }
}

function parseLatexSyncTex(raw: string, workDir: string): LatexSyncTexEntry[] {
  const inputByTag = new Map<number, string>()
  const entries: LatexSyncTexEntry[] = []
  let page = 0

  for (const line of raw.split(/\r?\n/)) {
    const inputMatch = line.match(/^Input:(\d+):(.+)$/)
    if (inputMatch) {
      const tag = Number(inputMatch[1])
      const normalizedPath = normalizeSyncTexPath(inputMatch[2], workDir)
      if (Number.isInteger(tag) && normalizedPath) {
        inputByTag.set(tag, normalizedPath)
      }
      continue
    }

    const sheetMatch = line.match(/^(?:Sheet:|\{)(\d+)$/)
    if (sheetMatch) {
      page = Number(sheetMatch[1]) || page
      continue
    }

    if (!page) {
      continue
    }

    const recordMatch = line.match(/^(?:[\[(]|[a-z])(\d+),(\d+)(?::(\d+))?:(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+))?/i)
    if (!recordMatch) {
      continue
    }

    const tag = Number(recordMatch[1])
    const sourceLine = Number(recordMatch[2])
    const sourceColumn = recordMatch[3] ? Number(recordMatch[3]) : null
    const x = Number(recordMatch[4])
    const y = Number(recordMatch[5])
    const width = recordMatch[6] ? Number(recordMatch[6]) : null
    const height = recordMatch[7] ? Number(recordMatch[7]) : null
    const sourcePath = inputByTag.get(tag)
    if (!sourcePath || !Number.isFinite(sourceLine) || sourceLine < 1 || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }

    entries.push({
      filePath: sourcePath,
      line: sourceLine,
      column: sourceColumn && Number.isFinite(sourceColumn) && sourceColumn > 0 ? sourceColumn : null,
      page,
      x,
      y,
      width: width !== null && Number.isFinite(width) ? width : null,
      height: height !== null && Number.isFinite(height) ? height : null,
    })
  }

  return dedupeLatexSyncTexEntries(entries)
}

function normalizeSyncTexPath(value: string | undefined, workDir: string): string | null {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  const absolute = path.isAbsolute(raw) ? raw : path.resolve(workDir, raw)
  const relative = path.relative(workDir, absolute).replace(/\\/g, '/')
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(raw).replace(/\\/g, '/')
  }
  return relative
}

function dedupeLatexSyncTexEntries(entries: LatexSyncTexEntry[]): LatexSyncTexEntry[] {
  const seen = new Set<string>()
  const deduped: LatexSyncTexEntry[] = []
  for (const entry of entries) {
    const key = `${entry.filePath}:${entry.line}:${entry.column ?? ''}:${entry.page}:${entry.x}:${entry.y}:${entry.width ?? ''}:${entry.height ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

function selectBibliographyCommand(files: CompileWorkspaceFile[], entryPath: string): { command: string; args: string[] } | null {
  const normalizedEntryPath = normalizeDependencyPath(entryPath)
  const entryFile = files.find((file) => normalizeDependencyPath(file.path) === normalizedEntryPath)
  if (!entryFile || typeof entryFile.content !== 'string') {
    return null
  }

  const source = entryFile.content.toLowerCase()
  const usesBiblatex = source.includes('\\addbibresource{') || source.includes('\\printbibliography')
  const usesBibtex = source.includes('\\bibliography{') || source.includes('\\bibliographystyle{')

  if (usesBiblatex) {
    return { command: 'biber', args: ['--quiet'] }
  }

  if (usesBibtex) {
    return { command: 'bibtex', args: [] }
  }

  return null
}

function latexLogNeedsRerun(log: string): boolean {
  return /\bRerun to get (?:cross-references|citations) right\b/i.test(log)
    || /\bThere were undefined (?:references|citations)\b/i.test(log)
    || /\b(?:Reference|Citation)\s+`[^`]+['’]\s+on page\b.*\bundefined\b/i.test(log)
    || /\bLabel\(s\) may have changed\. Rerun to get cross-references right\b/i.test(log)
}

function isCompileControlErrorMessage(message: string): boolean {
  return /\btimed out after \d+ms\b/i.test(message) || /compile cancelled/i.test(message)
}

function runLatexCommand(
  bin: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ exitCode: number; log: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Compile cancelled'))
      return
    }

    const proc = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    const chunks: Buffer[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void = () => undefined
    const settleReject = (error: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const settleResolve = (exitCode: number, log: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode, log })
    }
    timer = setTimeout(() => {
      proc.kill('SIGKILL')
      settleReject(new Error(`${bin} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    onAbort = () => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        try { proc.kill('SIGKILL') } catch {}
      }, 250)
      settleReject(new Error('Compile cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    proc.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    proc.on('error', (err) => {
      settleReject(new Error(`Failed to start ${bin}: ${err.message}`))
    })
    proc.on('close', (code) => {
      settleResolve(code ?? 1, stripAnsi(Buffer.concat(chunks).toString('utf8')).trim())
    })
  })
}

function pathExists(value: string): boolean {
  return existsSync(value)
}

function updatePersistentWorkspace(state: PersistentWorkspaceState, files: CompileWorkspaceFile[]): void {
  const currentPaths = new Set(files.map((f) => f.path))

  for (const [filePath] of state.fileContentRefs) {
    if (!currentPaths.has(filePath)) {
      const absPath = resolveWorkspacePath(state.dir, filePath)
      try { rmSync(absPath, { recursive: true, force: true }) } catch {}
      state.fileContentRefs.delete(filePath)
    }
  }

  for (const file of files) {
    if (state.fileContentRefs.get(file.path) !== file.content) {
      const absPath = resolveWorkspacePath(state.dir, file.path)

      // Ensure the path is not a directory if we're about to write a file there
      if (existsSync(absPath) && statSync(absPath).isDirectory()) {
        rmSync(absPath, { recursive: true, force: true })
      }

      // Ensure all parent components are directories (not files)
      const parentDir = path.dirname(absPath)
      ensureDirectory(parentDir)

      if (typeof file.content === 'string') {
        writeFileSync(absPath, file.content, 'utf8')
      } else {
        writeFileSync(absPath, file.content)
      }
      state.fileContentRefs.set(file.path, file.content)
    }
  }
}

function ensureDirectory(dirPath: string): void {
  if (existsSync(dirPath)) {
    if (statSync(dirPath).isDirectory()) {
      return
    }
    rmSync(dirPath, { recursive: true, force: true })
  }
  const parent = path.dirname(dirPath)
  if (parent !== dirPath) {
    ensureDirectory(parent)
  }
  mkdirSync(dirPath, { recursive: true })
}

function clearSvgOutputs(dir: string): void {
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('output-') && f.endsWith('.svg')) {
        rmSync(path.join(dir, f), { force: true })
      }
    }
  } catch {}
}

function writeWorkspaceFiles(tmpDir: string, files: CompileWorkspaceFile[]): void {
  for (const file of files) {
    const filePath = resolveWorkspacePath(tmpDir, file.path)
    ensureDirectory(path.dirname(filePath))
    if (typeof file.content === 'string') {
      writeFileSync(filePath, file.content, 'utf8')
    } else {
      writeFileSync(filePath, file.content)
    }
  }
}

function resolveWorkspacePath(tmpDir: string, relativePath: string): string {
  const normalizedPath = path.normalize(relativePath).replace(/^([/\\])+/, '')

  if (!normalizedPath || normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
    throw new Error(`Invalid project file path: ${relativePath}`)
  }

  return path.join(tmpDir, normalizedPath)
}

function getCompileCacheKey(input: { entryPath: string; files: CompileWorkspaceFile[] }): string {
  const hash = createHash('sha256')
  hash.update(input.entryPath)

  const dependentFiles = collectDependencyFiles(input)
  for (const file of dependentFiles) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.mimeType ?? '')
    hash.update('\0')
    if (typeof file.content === 'string') {
      hash.update(Buffer.from(file.content, 'utf8'))
    } else {
      let bufHash = bufferHashCache.get(file.content)
      if (!bufHash) {
        bufHash = createHash('sha256').update(file.content).digest('hex')
        bufferHashCache.set(file.content, bufHash)
      }
      hash.update(bufHash)
    }
    hash.update('\0')
  }

  return hash.digest('hex')
}

function collectDependencyFiles(input: { entryPath: string; files: CompileWorkspaceFile[] }): CompileWorkspaceFile[] {
  const fileMap = new Map(input.files.map((file) => [normalizeDependencyPath(file.path), file] as const))
  const visited = new Set<string>()
  const dependencies = new Set<string>()
  const missingDependencies = new Set<string>()
  const stack = [normalizeDependencyPath(input.entryPath)]

  while (stack.length > 0) {
    const currentPath = stack.pop()!
    if (visited.has(currentPath)) {
      continue
    }

    visited.add(currentPath)
    const currentFile = fileMap.get(currentPath)
    if (!currentFile) {
      missingDependencies.add(currentPath)
      continue
    }

    dependencies.add(currentPath)

    if (typeof currentFile.content !== 'string' || !isDependencySourceFile(currentFile.path, currentFile.mimeType)) {
      continue
    }

    for (const reference of extractDependencyReferences(currentFile.path, currentFile.content)) {
      const resolvedPath = resolveDependencyPath(reference.sourcePath, reference.targetPath)
      if (!resolvedPath) {
        missingDependencies.add(`${reference.sourcePath}->${reference.targetPath}`)
        continue
      }

      if (fileMap.has(resolvedPath)) {
        stack.push(resolvedPath)
      } else {
        missingDependencies.add(resolvedPath)
      }
    }
  }

  const files = [...dependencies]
    .map((filePath) => fileMap.get(filePath))
    .filter((file): file is CompileWorkspaceFile => Boolean(file))
    .sort((left, right) => left.path.localeCompare(right.path))

  for (const missingDependency of [...missingDependencies].sort()) {
    files.push({
      path: `__missing__/${missingDependency}`,
      mimeType: 'text/x.typst-missing-dependency',
      content: missingDependency,
    })
  }

  return files
}

function extractDependencyReferences(sourcePath: string, content: string): DependencyReference[] {
  const references: DependencyReference[] = []
  const patterns = [
    /(?:^|[^\w-])#?include\s+"([^"]+)"/gm,
    /(?:^|[^\w-])#?import\s+"([^"]+)"/gm,
    /(?:^|[^\w-])#?image\(\s*"([^"]+)"/gm,
    /(?:^|[^\w-])#?bibliography\(\s*"([^"]+)"/gm,
  ]

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const targetPath = match[1]?.trim()
      if (!targetPath) {
        continue
      }

      references.push({ sourcePath, targetPath })
    }
  }

  return references
}

function resolveDependencyPath(sourcePath: string, targetPath: string): string | null {
  if (!targetPath || targetPath.startsWith('@')) {
    return null
  }

  const baseDir = path.posix.dirname(normalizeDependencyPath(sourcePath))
  const resolved = normalizeDependencyPath(
    targetPath.startsWith('/') ? targetPath.slice(1) : path.posix.join(baseDir === '.' ? '' : baseDir, targetPath),
  )

  if (!resolved || resolved.startsWith('../') || resolved === '..') {
    return null
  }

  return resolved
}

function normalizeDependencyPath(filePath: string): string {
  return path.posix.normalize(filePath).replace(/^\/+/, '')
}

function isDependencySourceFile(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) {
    return true
  }

  return /\.(typ|txt|md|yaml|yml|json|toml|xml|bib)$/i.test(filePath)
}

export function parseCompileDiagnostics(stderr: string, fallbackPath?: string): CompileDiagnostic[] {
  const normalized = stripAnsi(stderr).trim()
  if (!normalized) {
    return []
  }

  const typstDiagnostics = parseTypstCompileDiagnostics(normalized, fallbackPath)
  if (typstDiagnostics.length > 0) {
    return typstDiagnostics
  }

  return parseLatexCompileDiagnostics(normalized, fallbackPath ?? null)
}

function parseTypstCompileDiagnostics(normalized: string, fallbackPath?: string): CompileDiagnostic[] {
  const blocks = normalized
    .split(/\n(?=(?:error|warning):\s)/i)
    .map((block) => block.trim())
    .filter((block) => /^(?:error|warning):\s/i.test(block))

  if (blocks.length === 0) {
    return []
  }

  return blocks.map((block) => {
    const lines = block.split('\n')
    const firstLine = lines[0] ?? ''
    const level = /^warning:/i.test(firstLine) ? 'warning' : 'error'
    const message = firstLine.replace(/^(error|warning):\s*/i, '').trim() || 'Compilation issue'
    const locationMatch = block.match(/([^\s:][^:\n]*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/)

    return {
      level,
      message,
      filePath: locationMatch?.[1] ?? fallbackPath ?? null,
      line: locationMatch?.[2] ? Number(locationMatch[2]) : null,
      column: locationMatch?.[3] ? Number(locationMatch[3]) : null,
      raw: block,
    }
  })
}

function parseLatexCompileDiagnostics(raw: string, defaultFilePath: string | null): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = []
  const lines = raw.split(/\r?\n/)
  let pending: { level: 'error' | 'warning'; message: string; raw: string } | null = null
  let firstUnlocatedIssue: { level: 'error' | 'warning'; message: string; raw: string } | null = null

  for (const line of lines) {
    const normalized = stripAnsi(line).trim()
    if (!normalized) {
      continue
    }

    const fileLocation = normalized.match(/([./A-Za-z0-9_-][^:\s]*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/)
    if (fileLocation) {
      diagnostics.push({
        level: pending?.level ?? (isLatexWarningLine(normalized) ? 'warning' : 'error'),
        message: pending?.message ?? normalized,
        filePath: normalizeLatexLogPath(fileLocation[1]),
        line: Number(fileLocation[2]),
        column: fileLocation[3] ? Number(fileLocation[3]) : 1,
        raw: pending ? `${pending.raw}\n${normalized}` : normalized,
      })
      pending = null
      continue
    }

    const texLine = normalized.match(/\bl\.(\d+)\b/)
    if (texLine && (pending || defaultFilePath)) {
      const lineNumber = Number(texLine[1])
      const previous = diagnostics.at(-1)
      if (!pending && previous?.filePath === defaultFilePath && previous.line === lineNumber) {
        continue
      }

      diagnostics.push({
        level: pending?.level ?? 'error',
        message: pending?.message ?? normalized,
        filePath: defaultFilePath,
        line: lineNumber,
        column: 1,
        raw: pending ? `${pending.raw}\n${normalized}` : normalized,
      })
      pending = null
      continue
    }

    if (isLatexErrorLine(normalized)) {
      pending = { level: 'error', message: normalized, raw: normalized }
      firstUnlocatedIssue ??= pending
    } else if (isLatexWarningLine(normalized)) {
      pending = { level: 'warning', message: normalized, raw: normalized }
      firstUnlocatedIssue ??= pending
    }
  }

  if (diagnostics.length === 0 && firstUnlocatedIssue) {
    diagnostics.push({
      level: firstUnlocatedIssue.level,
      message: firstUnlocatedIssue.message,
      filePath: defaultFilePath,
      line: null,
      column: null,
      raw: firstUnlocatedIssue.raw,
    })
  }

  return dedupeCompileDiagnostics(diagnostics)
}

function normalizeLatexLogPath(filePath: string): string {
  return filePath.replace(/^\.\//, '')
}

function isLatexErrorLine(line: string): boolean {
  return line.startsWith('!')
    || /^error[:\s]/i.test(line)
    || /\b(fatal error|emergency stop|undefined control sequence|missing \$ inserted|runaway argument)\b/i.test(line)
}

function isLatexWarningLine(line: string): boolean {
  return /\b(?:LaTeX|Package|Class|pdfTeX|LuaTeX|XeTeX)\s+Warning\b/i.test(line)
}

function dedupeCompileDiagnostics(diagnostics: CompileDiagnostic[]): CompileDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.level,
      diagnostic.message,
      diagnostic.filePath ?? '',
      diagnostic.line ?? '',
      diagnostic.column ?? '',
    ].join('|')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
