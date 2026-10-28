// Main-thread side of the Typst compiler. Compiles run in a dedicated worker
// (typstWasm.worker.ts) so the editor stays responsive; when a worker cannot
// be started the compiler is loaded on the main thread as before.
import type { TypstWasmPdfResult, TypstWasmSvgResult } from './typstWasm'
import type { TypstWorkerFile, TypstWorkerRequest, TypstWorkerResponse } from './typstWasm.worker'

export { isFatalTypstWasmError } from './typstWasmErrors'

type PendingRequest = {
  request: TypstWorkerRequest
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let workerAnswered = false
let workerUnavailable = false
let nextRequestId = 0
const pending = new Map<number, PendingRequest>()

function startWorker(): Worker | null {
  if (worker || workerUnavailable) return worker

  try {
    worker = new Worker(new URL('./typstWasm.worker.ts', import.meta.url), { type: 'module', name: 'typst-compiler' })
  } catch {
    workerUnavailable = true
    return null
  }

  worker.onmessage = ({ data }: MessageEvent<TypstWorkerResponse>) => {
    workerAnswered = true
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) {
      entry.resolve(data.result)
    } else {
      const error = new Error(data.message)
      error.stack = data.stack || error.stack
      entry.reject(error)
    }
  }

  worker.onerror = (event) => {
    event.preventDefault()
    const failed = [...pending.values()]
    pending.clear()
    worker?.terminate()
    worker = null

    if (!workerAnswered) {
      // The worker never started (e.g. module workers unsupported): fall back.
      workerUnavailable = true
      for (const entry of failed) {
        runOnMainThread(entry.request).then(entry.resolve, entry.reject)
      }
      return
    }

    // The worker crashed mid-compile; report it as a WebAssembly runtime error
    // so the caller resets and retries.
    const error = new Error(`RuntimeError: Typst compiler worker crashed: ${event.message || 'unknown error'}`)
    for (const entry of failed) entry.reject(error)
  }

  return worker
}

async function runOnMainThread(request: TypstWorkerRequest): Promise<unknown> {
  const compiler = await import('./typstWasm')
  return request.kind === 'pdf'
    ? compiler.compileTypstWasmToPdf(request.source, request.entryPath, request.files)
    : compiler.compileTypstWasm(request.source, request.entryPath, request.files)
}

function runCompile(kind: TypstWorkerRequest['kind'], source: string, entryPath: string, files: TypstWorkerFile[]): Promise<unknown> {
  const request: TypstWorkerRequest = { id: ++nextRequestId, kind, source, entryPath, files }
  const activeWorker = startWorker()
  if (!activeWorker) return runOnMainThread(request)

  return new Promise((resolve, reject) => {
    pending.set(request.id, { request, resolve, reject })
    activeWorker.postMessage(request)
  })
}

export function compileTypstWasm(source: string, entryPath: string, files: TypstWorkerFile[]): Promise<TypstWasmSvgResult> {
  return runCompile('svg', source, entryPath, files) as Promise<TypstWasmSvgResult>
}

export function compileTypstWasmToPdf(source: string, entryPath: string, files: TypstWorkerFile[]): Promise<TypstWasmPdfResult> {
  return runCompile('pdf', source, entryPath, files) as Promise<TypstWasmPdfResult>
}

// Throw away all compiler state by replacing the worker.
export function resetTypstWasmState(): void {
  if (worker) {
    worker.terminate()
    worker = null
    workerAnswered = false
    const error = new Error('Typst compiler was restarted')
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    startWorker()
    return
  }

  if (workerUnavailable) {
    void import('./typstWasm').then((compiler) => compiler.resetTypstWasmState())
  }
}

// Start the worker (and with it the compiler warm-up) soon after page load.
if (typeof window !== 'undefined') {
  setTimeout(() => startWorker(), 100)
}
