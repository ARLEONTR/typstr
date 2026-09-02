import { useState, useCallback, useRef, useEffect } from 'react'
import { apiClient } from '../api/client'
import type { CompileDiagnostic, CompilePreviewFormat, CompileResponse, LatexSyncTexEntry } from '../types'
import { compileLatexWasmToPdf, isBusytexRunnerReady, warmBusytexAssetsInBackground } from '../latexWasm'
import { compileTypstWasm, compileTypstWasmToPdf, isFatalTypstWasmError, resetTypstWasmState } from '../typstWasm'
import type { LatexEngine } from '../latexWasm'

export type LatexWebPreviewEngine = 'pandoc-wasm' | 'make4ht' | 'pandoc'

interface CompileErrorResponse {
  error?: string
  diagnostics?: CompileDiagnostic[]
}

interface CompileContext {
  projectId?: string
  fileId?: string
  entryFilePath?: string
  activeFileId?: string
  activeFilePath?: string
  activeSource?: string
  documentFormat?: 'typst' | 'latex'
  format?: CompilePreviewFormat
  latexEngine?: LatexEngine
  latexWebPreviewEngine?: LatexWebPreviewEngine
  previewSessionId?: string
  files?: Array<{ id?: string; path: string; content?: string; mimeType?: string; updatedAt?: number }>
}

interface UseCompileOptions {
  onSuccess?: () => void
}

const ENABLE_TYPST_SERVER_FALLBACK = import.meta.env.VITE_ENABLE_TYPST_SERVER_FALLBACK !== 'false'
export const ENABLE_LATEX_SERVER_FALLBACK = import.meta.env.VITE_ENABLE_LATEX_SERVER_FALLBACK !== 'false'
export const ENABLE_LATEX_WASM_PDF = import.meta.env.VITE_ENABLE_LATEX_WASM_PDF === 'true'

function requestKey(source: string, context?: CompileContext): string {
  return JSON.stringify({
    source,
    projectId: context?.projectId ?? null,
    fileId: context?.fileId ?? null,
    entryFilePath: context?.entryFilePath ?? null,
    activeFileId: context?.activeFileId ?? null,
    activeFilePath: context?.activeFilePath ?? null,
    activeSource: context?.activeSource ?? null,
    documentFormat: context?.documentFormat ?? 'typst',
    format: context?.format ?? 'svg',
    latexEngine: context?.latexEngine ?? null,
    latexWebPreviewEngine: context?.latexWebPreviewEngine ?? null,
    previewSessionId: context?.previewSessionId ?? null,
    files: compileFilesFingerprint(context?.files),
  })
}

function compileFilesFingerprint(files: CompileContext['files'] | undefined) {
  if (!files) {
    return null
  }

  return files.map((file) => ({
    id: file.id ?? null,
    path: file.path,
    mimeType: file.mimeType ?? null,
    updatedAt: file.updatedAt ?? null,
    content: typeof file.content === 'string' ? stringVersionFingerprint(file.content) : null,
  }))
}

function stringVersionFingerprint(value: string): string {
  if (value.length <= 128) {
    return value
  }

  return `${value.length}:${value.slice(0, 64)}:${value.slice(-64)}`
}

function isLatexPreviewRequest(context?: CompileContext): boolean {
  return context?.documentFormat === 'latex'
}

function latexCompileKey(context?: CompileContext): string {
  return [
    context?.projectId ?? 'standalone',
    context?.entryFilePath ?? context?.activeFilePath ?? context?.fileId ?? 'main.tex',
    context?.latexEngine ?? 'auto',
  ].join(':')
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

function parseCompileDiagnostics(raw: string | null | undefined, defaultFilePath?: string | null): CompileDiagnostic[] {
  const normalized = raw ? stripAnsi(raw).trim() : ''
  if (!normalized) {
    return []
  }

  const latexDiagnostics = parseLatexCompileDiagnostics(normalized, defaultFilePath ?? null)
  if (latexDiagnostics.length > 0) {
    return latexDiagnostics
  }

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
    const level = /^warning:/i.test(firstLine) ? 'warning' as const : 'error' as const
    const message = firstLine.replace(/^(error|warning):\s*/i, '').trim() || 'Compilation issue'
    const locationMatch = block.match(/([^\s:][^:\n]*\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/)

    return {
      level,
      message,
      filePath: locationMatch?.[1] ?? null,
      line: locationMatch?.[2] ? Number(locationMatch[2]) : null,
      column: locationMatch?.[3] ? Number(locationMatch[3]) : null,
      raw: block,
    }
  })
}

function parseTypstWasmDiagnostics(error: unknown): CompileDiagnostic[] {
  if (Array.isArray(error)) {
    return error.flatMap((entry) => parseTypstWasmDiagnostics(entry))
  }

  if (typeof error === 'object' && error !== null) {
    const maybeDiagnostics = (error as { diagnostics?: unknown }).diagnostics
    if (Array.isArray(maybeDiagnostics)) {
      return maybeDiagnostics.flatMap((entry) => parseTypstWasmDiagnostics(entry))
    }

    const maybeSeverity = (error as { severity?: unknown }).severity
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string') {
      return [{
        level: normalizeDiagnosticLevel(maybeSeverity),
        message: maybeMessage,
        filePath: null,
        line: null,
        column: null,
        raw: stringifyUnknownError(error),
      }]
    }
  }

  const raw = stringifyUnknownError(error)
  const diagnostics: CompileDiagnostic[] = []
  const diagnosticPattern = /SourceDiagnostic\s*\{\s*severity:\s*(Error|Warning)[\s\S]*?message:\s*"((?:\\.|[^"\\])*)"/g
  for (const match of raw.matchAll(diagnosticPattern)) {
    diagnostics.push({
      level: match[1] === 'Warning' ? 'warning' : 'error',
      message: decodeRustDebugString(match[2] ?? 'Compilation issue'),
      filePath: null,
      line: null,
      column: null,
      raw: match[0],
    })
  }
  if (diagnostics.length === 0) {
    const panicMatch = raw.match(/panicked with:\s*["“]((?:\\.|[^"”\\])*)["”]/i)
    if (panicMatch) {
      diagnostics.push({
        level: 'error',
        message: decodeRustDebugString(panicMatch[1] ?? 'Typst package panicked.'),
        filePath: null,
        line: null,
        column: null,
        raw,
      })
    }
  }
  return diagnostics
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
      diagnostics.push({
        level: pending?.level ?? 'error',
        message: pending?.message ?? normalized,
        filePath: defaultFilePath,
        line: Number(texLine[1]),
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

function latestLatexPassLog(rawLog: string | null): string | null {
  if (!rawLog) {
    return null
  }

  const logSections = Array.from(rawLog.matchAll(/\nLOG:\n([\s\S]*?)\n==\nSTDOUT:/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
  return logSections.at(-1) ?? rawLog
}

function parseSuccessfulLatexCompileDiagnostics(rawLog: string | null, defaultFilePath: string | null): CompileDiagnostic[] {
  return parseCompileDiagnostics(latestLatexPassLog(rawLog), defaultFilePath)
    .filter((diagnostic) => diagnostic.level !== 'error')
    .filter((diagnostic) => !isResolvedLatexRerunWarning(diagnostic.message))
}

function isResolvedLatexRerunWarning(message: string): boolean {
  return /\b(?:Citation|Reference)\s+`[^`]+['’]\s+on page\b.*\bundefined\b/i.test(message)
    || /\bThere were undefined (?:citations|references)\b/i.test(message)
    || /\bRerun to get (?:cross-references|citations) right\b/i.test(message)
}

function normalizeLatexLogPath(path: string): string {
  return path.replace(/^\.\//, '')
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

function normalizeDiagnosticLevel(value: unknown): 'error' | 'warning' {
  return String(value ?? '').toLowerCase() === 'warning' ? 'warning' : 'error'
}

function decodeRustDebugString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value
  }
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error ?? '')
  }
}

function compileMessageFromDiagnostics(diagnostics: CompileDiagnostic[], fallback: string): string {
  const firstError = diagnostics.find((diagnostic) => diagnostic.level === 'error') ?? diagnostics[0]
  return firstError?.message ?? fallback
}

function compileMessageFromLog(rawLog: string | null, defaultFilePath: string | null, fallback: string): string {
  const diagnostics = parseCompileDiagnostics(rawLog, defaultFilePath)
  return compileMessageFromDiagnostics(diagnostics, conciseCompileFallback(fallback))
}

function conciseCompileFallback(message: string): string {
  const lines = stripAnsi(message).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => isLatexErrorLine(line) || isLatexWarningLine(line))
    ?? lines.find((line) => !isCompileWrapperLine(line) && !isBusytexWrapperLine(line) && !isCompilerBannerLine(line))
    ?? 'Compilation failed'
}

function isCompileWrapperLine(line: string): boolean {
  return line.startsWith('$')
    || /^EXITCODE:/i.test(line)
    || /^(TEXMFLOG|MISSFONTLOG|LOG|STDOUT|STDERR|==|======):?$/i.test(line)
}

function isBusytexWrapperLine(line: string): boolean {
  return /(?:^|\s)\/bin\/busytex\s+(?:stdout|stderr):/i.test(line)
    || /^dependency:\s+datafile_build\/wasm\/texlive-(?:basic|recommended|extra)\.data$/i.test(line)
    || /\bstill waiting on run dependencies\b/i.test(line)
    || /\bDownloading data\.\.\./i.test(line)
    || /\(end of list\)$/.test(line)
}

function isCompilerBannerLine(line: string): boolean {
  return /^This is (?:pdfTeX|LuaHBTeX|LuaTeX|XeTeX|BibTeX|MakeIndex), Version\b/i.test(line)
    || /^entering extended mode$/i.test(line)
    || /^LaTeX2e\b/i.test(line)
    || /^L3 programming layer\b/i.test(line)
}

function shouldFallbackLatexWasmToServer(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lowered = message.toLowerCase()

  return lowered.includes('busytex')
    || lowered.includes('wasm')
    || lowered.includes('failed to fetch')
    || lowered.includes('asset')
    || lowered.includes('missing')
    || lowered.includes('program exited')
    || lowered.includes('fatal error')
    || lowered.includes('cannot read from terminal')
    || lowered.includes('no output pdf file produced')
}

function isVsCodeIntegratedBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const ua = (navigator.userAgent || '').toLowerCase()
  return ua.includes('vscode') || ua.includes('electron')
}

export function useCompile(options: UseCompileOptions = {}) {
  const onSuccessRef = useRef(options.onSuccess)
  onSuccessRef.current = options.onSuccess

  const [pages, setPages] = useState<string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [webPreviewHtml, setWebPreviewHtml] = useState<string | null>(null)
  const [isCompiling, setIsCompiling] = useState(false)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [compileDiagnostics, setCompileDiagnostics] = useState<CompileDiagnostic[]>([])
  const [effectivePreviewFormat, setEffectivePreviewFormat] = useState<CompilePreviewFormat>('svg')
  const [compileNotice, setCompileNotice] = useState<string | null>(null)
  const [compileLog, setCompileLog] = useState<string | null>(null)
  const [latexSyncTex, setLatexSyncTex] = useState<LatexSyncTexEntry[]>([])
  const [latexSyncTexToken, setLatexSyncTexToken] = useState<string | null>(null)
  const [latexSyncTexEntryPath, setLatexSyncTexEntryPath] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const compileRunIdRef = useRef(0)
  const latestCompletedKeyRef = useRef<string | null>(null)
  const queuedRequestRef = useRef<{ source: string; context?: CompileContext } | null>(null)
  const isCompileInFlightRef = useRef(false)
  const pdfUrlRef = useRef<string | null>(null)
  const binaryFileCacheRef = useRef<Map<string, Promise<Uint8Array>>>(new Map())
  const latexInitialServerCompileKeysRef = useRef<Set<string>>(new Set())

  const replacePdfUrl = useCallback((nextUrl: string | null) => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current)
    }

    pdfUrlRef.current = nextUrl
    setPdfUrl(nextUrl)
  }, [])

  const compile = useCallback(async (source: string, context?: CompileContext) => {
    if (!source.trim()) {
      return
    }

    queuedRequestRef.current = { source, context }
    if (isCompileInFlightRef.current) {
      abortRef.current?.abort()
      return
    }

    const runId = compileRunIdRef.current + 1
    compileRunIdRef.current = runId
    isCompileInFlightRef.current = true
    setIsCompiling(true)

    try {
      while (queuedRequestRef.current) {
        const nextRequest = queuedRequestRef.current
        queuedRequestRef.current = null

        const nextRequestKey = requestKey(nextRequest.source, nextRequest.context)
        if (latestCompletedKeyRef.current === nextRequestKey) {
          continue
        }

        abortRef.current = new AbortController()
        const signal = abortRef.current.signal
        const preferServerForLatexInThisRuntime = isVsCodeIntegratedBrowser()
        const allowLatexServerFallback = ENABLE_LATEX_SERVER_FALLBACK || preferServerForLatexInThisRuntime
        const allowLatexWasmPdf = ENABLE_LATEX_WASM_PDF && !preferServerForLatexInThisRuntime
        setCompileError(null)
        setCompileNotice(null)
        setCompileLog(null)
        let usedServerFallbackFromWasm = false

        try {
          if (nextRequest.context?.documentFormat === 'typst') {
            const files = await resolveTypstCompileFiles(
              nextRequest.context.projectId,
              applyActiveFileOverride(
              nextRequest.context.files || [],
              nextRequest.context.activeFilePath,
              nextRequest.context.activeSource,
              ),
              binaryFileCacheRef.current,
            )
            if (signal.aborted) {
              if (queuedRequestRef.current) continue
              return
            }
            const entryPath = nextRequest.context.entryFilePath ?? 'main.typ'

            try {
              if ((nextRequest.context?.format ?? 'svg') === 'pdf') {
                const pdfResult = await compileTypstWasmToPdf(nextRequest.source, entryPath, files)
                if (signal.aborted) {
                  if (queuedRequestRef.current) continue
                  return
                }
                latestCompletedKeyRef.current = nextRequestKey
                setCompileDiagnostics([])
                setCompileNotice('Compiled locally via Typst WebAssembly.')
                setCompileLog(null)
                setEffectivePreviewFormat('pdf')
                onSuccessRef.current?.()
                setWebPreviewHtml(null)
                setPages([])
                setPageCount(0)
                setPageOffset(0)
                replacePdfUrl(typedBytesToPdfObjectUrl(pdfResult.pdf))
                continue
              }

              const result = await compileTypstWasm(nextRequest.source, entryPath, files)
              if (signal.aborted) {
                if (queuedRequestRef.current) continue
                return
              }
              latestCompletedKeyRef.current = nextRequestKey
              setCompileDiagnostics([])
              setCompileNotice('Compiled locally via Typst WebAssembly.')
              setCompileLog(null)
              setEffectivePreviewFormat('svg')
              onSuccessRef.current?.()
              setWebPreviewHtml(null)
              replacePdfUrl(null)
              setPages(result.pages)
              setPageCount(result.pageCount)
              setPageOffset(result.pageOffset)
              continue
            } catch (wasmError: unknown) {
              if (isFatalTypstWasmError(wasmError)) {
                resetTypstWasmState()
              }
              if (!ENABLE_TYPST_SERVER_FALLBACK) {
                throw wasmError
              }
              const message = stringifyUnknownError(wasmError)
              if (message) {
                console.warn('[compile:typst-wasm] fallback to server compiler:', message)
              }
              usedServerFallbackFromWasm = true
            }
          }


          if (isLatexPreviewRequest(nextRequest.context)) {
            if ((nextRequest.context?.format ?? 'svg') === 'svg') {
              if (!nextRequest.context?.projectId) {
                throw new Error('projectId is required for LaTeX web preview.')
              }

              let pandocWasmFallbackLog: string | null = null

              try {
                const latexFiles = await resolveLatexCompileFiles(
                  nextRequest.context?.projectId,
                  applyActiveFileOverride(
                    nextRequest.context?.files || [],
                    nextRequest.context?.activeFilePath,
                    nextRequest.context?.activeSource,
                  ),
                  nextRequest.context?.entryFilePath ?? 'main.tex',
                  nextRequest.source,
                  binaryFileCacheRef.current,
                )

                if (signal.aborted) {
                  return
                }

                const latexPreviewSourceFiles = applyActiveFileOverride(
                  nextRequest.context?.files || [],
                  nextRequest.context?.activeFilePath,
                  nextRequest.context?.activeSource,
                )
                const { convertLatexWorkspaceToHtmlWithPandocWasm, shouldUsePandocWasmForLatexPreview, sanitizeLatexPreviewHtmlForSandbox } = await import('../latexWebPreview')
                const preferredWebEngine = nextRequest.context?.latexWebPreviewEngine ?? 'make4ht'

                if (preferredWebEngine === 'pandoc-wasm') {
                  if (!shouldUsePandocWasmForLatexPreview(nextRequest.source)) {
                    if (!allowLatexServerFallback) {
                      throw new Error('pandoc-wasm skipped: this LaTeX document uses figures or a multi-column layout that requires server preview.')
                    }
                    pandocWasmFallbackLog = 'pandoc-wasm skipped: this LaTeX document uses figures or a multi-column layout that requires server preview.'
                  } else {
                    const localPreview = await convertLatexWorkspaceToHtmlWithPandocWasm({
                      projectId: nextRequest.context.projectId,
                      entryPath: nextRequest.context.entryFilePath ?? 'main.tex',
                      source: nextRequest.source,
                      files: latexFiles.map((file) => {
                        const sourceFile = nextRequest.context?.files?.find((candidate) => normalizeCompilePath(candidate.path) === normalizeCompilePath(file.path))
                        return {
                          id: sourceFile?.id,
                          path: file.path,
                          content: file.content,
                          mimeType: sourceFile?.mimeType,
                        }
                      }),
                      sourceFiles: latexPreviewSourceFiles,
                    })

                    if (signal.aborted) {
                      return
                    }

                    latestCompletedKeyRef.current = nextRequestKey
                    setCompileDiagnostics([])
                    setCompileNotice('Web preview generated locally via Pandoc WebAssembly.')
                    setCompileLog(localPreview.rawLog)
                    setEffectivePreviewFormat('svg')
                    onSuccessRef.current?.()
                    setPages([])
                    setPageCount(0)
                    setPageOffset(0)
                    replacePdfUrl(null)
                    setWebPreviewHtml(sanitizeLatexPreviewHtmlForSandbox(localPreview.html))
                    continue
                  }
                }
              } catch (pandocWasmError) {
                const rawPandocWasmLog = typeof pandocWasmError === 'object' && pandocWasmError !== null && 'rawLog' in pandocWasmError && typeof (pandocWasmError as { rawLog?: unknown }).rawLog === 'string'
                  ? (pandocWasmError as { rawLog: string }).rawLog
                  : null
                pandocWasmFallbackLog = rawPandocWasmLog
                  ? `pandoc-wasm failed: ${stringifyUnknownError(pandocWasmError)}\n\n${rawPandocWasmLog}`
                  : `pandoc-wasm failed: ${stringifyUnknownError(pandocWasmError)}`
                if (!allowLatexServerFallback) {
                  throw pandocWasmError
                }
              }

              if (!allowLatexServerFallback) {
                throw new Error('Server LaTeX web preview is disabled.')
              }

              const response = await apiClient.post<{ html: string; engine?: 'make4ht' | 'pandoc' }>(
                `/api/projects/${nextRequest.context.projectId}/preview-html`,
                {
                  source: nextRequest.source,
                  sourceFormat: 'latex',
                  entryFilePath: nextRequest.context.entryFilePath,
                  activeFileId: nextRequest.context.activeFileId,
                  activeSource: nextRequest.context.activeSource,
                  preferredEngine: nextRequest.context?.latexWebPreviewEngine,
                },
                { signal, timeout: 120_000 },
              )

              if (signal.aborted) {
                if (queuedRequestRef.current) continue
                return
              }
              latestCompletedKeyRef.current = nextRequestKey
              setCompileDiagnostics([])
              setCompileNotice(
                response.data.engine === 'make4ht'
                  ? 'Web preview generated on the server via make4ht.'
                  : 'Web preview generated on the server via Pandoc.',
              )
              setCompileLog(pandocWasmFallbackLog)
              setEffectivePreviewFormat('svg')
              onSuccessRef.current?.()
              setPages([])
              setPageCount(0)
              setPageOffset(0)
              replacePdfUrl(null)
              const { sanitizeLatexPreviewHtmlForSandbox } = await import('../latexWebPreview')
              setWebPreviewHtml(sanitizeLatexPreviewHtmlForSandbox(response.data.html ?? ''))
              continue
            }

            const currentLatexCompileKey = latexCompileKey(nextRequest.context)
            const busytexReady = isBusytexRunnerReady()
            const shouldUseServerForInitialLatexPdf =
              allowLatexServerFallback
              && (!busytexReady || !latexInitialServerCompileKeysRef.current.has(currentLatexCompileKey))

            if (allowLatexWasmPdf) {
              void warmBusytexAssetsInBackground().catch((error) => {
                console.warn('[busytex:warmup] background preparation failed:', stringifyUnknownError(error))
              })
            }

            if (allowLatexWasmPdf && !shouldUseServerForInitialLatexPdf) {
              try {
                const latexFiles = await resolveLatexCompileFiles(
                  nextRequest.context?.projectId,
                  applyActiveFileOverride(
                    nextRequest.context?.files || [],
                    nextRequest.context?.activeFilePath,
                    nextRequest.context?.activeSource,
                  ),
                  nextRequest.context?.entryFilePath ?? 'main.tex',
                  nextRequest.source,
                  binaryFileCacheRef.current,
                )
                if (signal.aborted) {
                  if (queuedRequestRef.current) continue
                  return
                }

                const latexResult = await compileLatexWasmToPdf(nextRequest.source, {
                  engine: nextRequest.context?.latexEngine,
                  entryPath: nextRequest.context?.entryFilePath ?? 'main.tex',
                  additionalFiles: latexFiles,
                })
                if (signal.aborted) {
                  if (queuedRequestRef.current) continue
                  return
                }
                latestCompletedKeyRef.current = nextRequestKey
                setCompileDiagnostics(parseSuccessfulLatexCompileDiagnostics(latexResult.log, nextRequest.context?.entryFilePath ?? 'main.tex'))
                setCompileLog(latexResult.log)
                setLatexSyncTex([])
                setLatexSyncTexToken(null)
                setLatexSyncTexEntryPath(null)
                setCompileNotice(
                  nextRequest.context?.latexEngine
                    ? `Compiled with BusyTeX WebAssembly (${nextRequest.context.latexEngine}).`
                    : 'Compiled with BusyTeX WebAssembly.',
                )
                setEffectivePreviewFormat('pdf')
                onSuccessRef.current?.()
                setPages([])
                setPageCount(0)
                setPageOffset(0)
                setWebPreviewHtml(null)
                replacePdfUrl(URL.createObjectURL(new Blob([latexResult.pdf as unknown as ArrayBuffer], { type: 'application/pdf' })))
                continue
              } catch (latexWasmError) {
                if (!allowLatexServerFallback || !shouldFallbackLatexWasmToServer(latexWasmError)) {
                  throw latexWasmError
                }
              }
            }

            if (!allowLatexServerFallback) {
              throw new Error('Server LaTeX PDF compilation is disabled and BusyTeX is not ready.')
            }

            const latexFallback = await apiClient.post<CompileResponse>(
              '/api/compile',
              {
                source: nextRequest.source,
                projectId: nextRequest.context?.projectId,
                fileId: nextRequest.context?.fileId,
                activeFileId: nextRequest.context?.activeFileId,
                activeSource: nextRequest.context?.activeSource,
                documentFormat: 'latex',
                format: 'pdf',
                latexEngine: nextRequest.context?.latexEngine,
              },
              { signal, timeout: 120_000 },
            )

            if (signal.aborted) {
              if (queuedRequestRef.current) continue
              return
            }
            if (latexFallback.data.format !== 'pdf') {
              throw new Error('Unexpected server response format for LaTeX PDF compile.')
            }
            latestCompletedKeyRef.current = nextRequestKey
            latexInitialServerCompileKeysRef.current.add(currentLatexCompileKey)
            setCompileDiagnostics(latexFallback.data.diagnostics ?? [])
            setCompileLog(latexFallback.data.log ?? null)
            setCompileNotice(
              shouldUseServerForInitialLatexPdf
                ? (
                  isBusytexRunnerReady()
                    ? 'First preview compiled on the server; BusyTeX is ready for the next compile.'
                    : 'First preview compiled on the server while BusyTeX finishes preparing in the browser.'
                )
                : (latexFallback.data.notice ?? 'Compiled on the server.')
            )
            setEffectivePreviewFormat('pdf')
            onSuccessRef.current?.()
            setPages([])
            setPageCount(0)
            setPageOffset(0)
            setWebPreviewHtml(null)
            setLatexSyncTex(latexFallback.data.syncTex ?? [])
            setLatexSyncTexToken(latexFallback.data.syncTexToken ?? null)
            setLatexSyncTexEntryPath(latexFallback.data.syncTexEntryPath ?? null)
            replacePdfUrl(base64PdfToObjectUrl(latexFallback.data.pdfBase64))
            continue
          }

          const res = await apiClient.post<CompileResponse>(
            '/api/compile',
            {
              source: nextRequest.source,
              projectId: nextRequest.context?.projectId,
              fileId: nextRequest.context?.fileId,
              activeFileId: nextRequest.context?.activeFileId,
              activeSource: nextRequest.context?.activeSource,
              documentFormat: nextRequest.context?.documentFormat,
              format: nextRequest.context?.format,
              latexEngine: nextRequest.context?.latexEngine,
              previewSessionId: nextRequest.context?.previewSessionId,
            },
            { signal, timeout: 120_000 },
          )

          if (signal.aborted) {
            if (queuedRequestRef.current) continue
            return
          }
          latestCompletedKeyRef.current = nextRequestKey
          setCompileDiagnostics(res.data.diagnostics ?? [])
          setCompileNotice(res.data.notice ?? (usedServerFallbackFromWasm ? 'Using server compiler fallback for this document.' : null))
          setCompileLog(null)
          setLatexSyncTex(res.data.format === 'pdf' ? (res.data.syncTex ?? []) : [])
          setLatexSyncTexToken(res.data.format === 'pdf' ? (res.data.syncTexToken ?? null) : null)
          setLatexSyncTexEntryPath(res.data.format === 'pdf' ? (res.data.syncTexEntryPath ?? null) : null)
          setEffectivePreviewFormat(res.data.format)
          onSuccessRef.current?.()
          setWebPreviewHtml(null)

          if (res.data.format === 'pdf') {
            setPages([])
            setPageCount(0)
            setPageOffset(0)
            replacePdfUrl(base64PdfToObjectUrl(res.data.pdfBase64))
          } else {
            replacePdfUrl(null)
            setPages(res.data.pages)
            setPageCount(res.data.pageCount)
            setPageOffset(res.data.pageOffset)
          }
        } catch (err: any) {
          if (err.name === 'CanceledError' || err.name === 'AbortError') {
            if (queuedRequestRef.current) {
              continue
            }
            return
          }

          const responseData = err.response?.data as CompileErrorResponse | undefined
          const wasmDiagnostics = parseTypstWasmDiagnostics(err)
          const fallbackMessage = err?.message ? String(err.message) : 'Compilation failed'
          const rawLog = typeof err?.log === 'string'
            ? err.log
            : wasmDiagnostics.length > 0
              ? wasmDiagnostics.map((diagnostic) => `${diagnostic.level}: ${diagnostic.message}`).join('\n')
              : typeof fallbackMessage === 'string'
                ? fallbackMessage
                : null
          const parsedDiagnostics = responseData?.diagnostics
            ?? (wasmDiagnostics.length > 0 ? wasmDiagnostics : parseCompileDiagnostics(rawLog, nextRequest.context?.entryFilePath ?? nextRequest.context?.activeFilePath ?? null))
          const message = responseData?.error
            ?? compileMessageFromDiagnostics(parsedDiagnostics, compileMessageFromLog(rawLog, nextRequest.context?.entryFilePath ?? nextRequest.context?.activeFilePath ?? null, fallbackMessage))
          setCompileError(message)
          setCompileDiagnostics(parsedDiagnostics)
          setCompileLog(rawLog)
          setLatexSyncTex([])
          setLatexSyncTexToken(null)
          setLatexSyncTexEntryPath(null)
          setCompileNotice(null)
          setWebPreviewHtml(null)
          if (nextRequest.context?.format === 'pdf' || isLatexPreviewRequest(nextRequest.context)) {
            replacePdfUrl(null)
          }
        }
      }
    } finally {
      if (compileRunIdRef.current === runId) {
        abortRef.current = null
        isCompileInFlightRef.current = false
        setIsCompiling(false)
      }
    }
  }, [])

  const compileNow = useCallback((source: string, context?: CompileContext) => {
    void compile(source, context)
  }, [compile])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current)
      }
    }
  }, [])

  const resetCompile = useCallback(() => {
    compileRunIdRef.current += 1
    abortRef.current?.abort()
    queuedRequestRef.current = null
    isCompileInFlightRef.current = false
    latestCompletedKeyRef.current = null
    setCompileError(null)
    setCompileDiagnostics([])
    setCompileNotice(null)
    setCompileLog(null)
    setLatexSyncTex([])
    setLatexSyncTexToken(null)
    setLatexSyncTexEntryPath(null)
    setIsCompiling(false)
    setWebPreviewHtml(null)
    setPages([])
    setPageCount(0)
    setPageOffset(0)
    setEffectivePreviewFormat('svg')
    replacePdfUrl(null)
  }, [replacePdfUrl])

  return { pages, pageCount, pageOffset, pdfUrl, webPreviewHtml, isCompiling, compileError, compileDiagnostics, effectivePreviewFormat, compileNotice, compileLog, latexSyncTex, latexSyncTexToken, latexSyncTexEntryPath, compileNow, resetCompile }
}

function applyActiveFileOverride(
  files: Array<{ id?: string; path: string; content?: string; mimeType?: string; updatedAt?: number }>,
  activeFilePath: string | undefined,
  activeSource: string | undefined,
): Array<{ id?: string; path: string; content?: string; mimeType?: string; updatedAt?: number }> {
  if (!activeFilePath || activeSource === undefined) {
    return files
  }

  let replaced = false
  const nextFiles = files.map((file) => {
    if (file.path !== activeFilePath) {
      return file
    }

    replaced = true
    return { ...file, content: activeSource }
  })

  return replaced ? nextFiles : [...nextFiles, { path: activeFilePath, content: activeSource }]
}

async function resolveTypstCompileFiles(
  projectId: string | undefined,
  files: Array<{ id?: string; path: string; content?: string; mimeType?: string; updatedAt?: number }>,
  binaryFileCache: Map<string, Promise<Uint8Array>>,
): Promise<Array<{ path: string; content: string | Uint8Array }>> {
  const resolvedFiles: Array<{ path: string; content: string | Uint8Array }> = []

  for (const file of files) {
    if (typeof file.content === 'string') {
      resolvedFiles.push({ path: file.path, content: file.content })
      continue
    }

    if (!shouldLoadBinaryCompileFile(file) || !projectId || !file.id) {
      continue
    }

    resolvedFiles.push({
      path: file.path,
      content: await fetchBinaryProjectFile(projectId, file.id, file.updatedAt, binaryFileCache),
    })
  }

  return resolvedFiles
}

function shouldLoadBinaryCompileFile(file: { path: string; mimeType?: string }): boolean {
  return /\.(png|jpe?g|pdf|svg|bmp|gif|webp|ttf|otf|ttc|woff|woff2)$/i.test(file.path)
    || Boolean(file.mimeType && (
      file.mimeType.startsWith('image/')
      || file.mimeType === 'application/pdf'
      || /^font\/|application\/font|application\/x-font/i.test(file.mimeType)
    ))
}

async function resolveLatexCompileFiles(
  projectId: string | undefined,
  files: Array<{ id?: string; path: string; content?: string; mimeType?: string; updatedAt?: number }>,
  entryPath: string,
  entrySource: string,
  binaryFileCache: Map<string, Promise<Uint8Array>>,
): Promise<Array<{ path: string; content: string | Uint8Array }>> {
  const normalizedEntryPath = normalizeCompilePath(entryPath || 'main.tex')
  const resolvedFiles: Array<{ path: string; content: string | Uint8Array }> = [
    { path: normalizedEntryPath, content: entrySource },
  ]
  const seenPaths = new Set<string>([normalizedEntryPath])

  for (const file of files) {
    const normalizedPath = normalizeCompilePath(file.path)
    if (!normalizedPath || seenPaths.has(normalizedPath)) {
      continue
    }

    if (typeof file.content === 'string') {
      resolvedFiles.push({ path: normalizedPath, content: file.content })
      seenPaths.add(normalizedPath)
      continue
    }

    if (!shouldLoadBinaryLatexCompileFile(file) || !projectId || !file.id) {
      continue
    }

    const binaryContent = await fetchBinaryProjectFile(projectId, file.id, file.updatedAt, binaryFileCache, { allowMissing: true })
    if (!binaryContent) {
      continue
    }

    resolvedFiles.push({
      path: normalizedPath,
      content: binaryContent,
    })
    seenPaths.add(normalizedPath)
  }

  return resolvedFiles
}

function shouldLoadBinaryLatexCompileFile(file: { path: string; mimeType?: string }): boolean {
  return /\.(png|jpe?g|pdf|eps|bmp|gif|webp|svg|ttf|otf|ttc|woff2?)$/i.test(file.path)
    || Boolean(file.mimeType && (
      file.mimeType.startsWith('image/')
      || file.mimeType === 'application/pdf'
      || /^font\/|application\/font|application\/x-font/i.test(file.mimeType)
    ))
}

function normalizeCompilePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

function fetchBinaryProjectFile(
  projectId: string,
  fileId: string,
  updatedAt: number | undefined,
  binaryFileCache: Map<string, Promise<Uint8Array>>,
): Promise<Uint8Array>
function fetchBinaryProjectFile(
  projectId: string,
  fileId: string,
  updatedAt: number | undefined,
  binaryFileCache: Map<string, Promise<Uint8Array>>,
  options: { allowMissing: true },
): Promise<Uint8Array | null>
async function fetchBinaryProjectFile(
  projectId: string,
  fileId: string,
  updatedAt: number | undefined,
  binaryFileCache: Map<string, Promise<Uint8Array>>,
  options?: { allowMissing?: boolean },
): Promise<Uint8Array | null> {
  const cacheKey = `${projectId}:${fileId}:${updatedAt ?? 'unknown'}`
  let pending = binaryFileCache.get(cacheKey)
  if (!pending) {
    pending = apiClient.get<ArrayBuffer>(
      `/api/projects/${projectId}/files/${fileId}/content`,
      { responseType: 'arraybuffer' },
    ).then((response) => new Uint8Array(response.data))
    binaryFileCache.set(cacheKey, pending)
  }

  try {
    return await pending
  } catch (error) {
    if (!options?.allowMissing || !isMissingBinaryProjectFileError(error)) {
      throw error
    }

    binaryFileCache.delete(cacheKey)
    return null
  }
}

function isMissingBinaryProjectFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { response?: { status?: number } }).response?.status === 404)
}

function base64PdfToObjectUrl(pdfBase64: string): string {
  const binary = window.atob(pdfBase64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

function typedBytesToPdfObjectUrl(bytes: Uint8Array): string {
  const copied = new Uint8Array(bytes.byteLength)
  copied.set(bytes)
  return URL.createObjectURL(new Blob([copied.buffer], { type: 'application/pdf' }))
}
