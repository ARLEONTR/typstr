/// <reference lib="webworker" />
// Runs the Typst WebAssembly compiler off the main thread, so compiling a
// large document no longer freezes the editor. See typstWasmClient.ts.
import { compileTypstWasm, compileTypstWasmToPdf, warmTypstWasmInBackground } from './typstWasm'

export type TypstWorkerFile = { path: string; content: string | Uint8Array }

export type TypstWorkerRequest = {
  id: number
  kind: 'svg' | 'pdf'
  source: string
  entryPath: string
  files: TypstWorkerFile[]
}

export type TypstWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string; stack: string }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async ({ data }: MessageEvent<TypstWorkerRequest>) => {
  try {
    if (data.kind === 'pdf') {
      const result = await compileTypstWasmToPdf(data.source, data.entryPath, data.files)
      // Copy out of WebAssembly memory so the buffer can be transferred.
      const pdf = result.pdf.slice()
      scope.postMessage({ id: data.id, ok: true, result: { ...result, pdf } } satisfies TypstWorkerResponse, [pdf.buffer])
      return
    }

    const result = await compileTypstWasm(data.source, data.entryPath, data.files)
    scope.postMessage({ id: data.id, ok: true, result } satisfies TypstWorkerResponse)
  } catch (error) {
    scope.postMessage({
      id: data.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error ?? 'Typst compilation failed'),
      stack: error instanceof Error ? error.stack ?? '' : '',
    } satisfies TypstWorkerResponse)
  }
}

warmTypstWasmInBackground()
