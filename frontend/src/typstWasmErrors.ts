// Errors after which the Typst WebAssembly state must be rebuilt. Shared by
// the compiler (which runs in a worker) and its main-thread client.
export function isFatalTypstWasmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const stack = error instanceof Error ? error.stack ?? '' : ''
  const haystack = `${message}\n${stack}`

  return haystack.includes('tinymist-package')
    || haystack.includes('Option::unwrap()')
    || haystack.includes('called `Option::unwrap()` on a `None` value')
    || haystack.includes('panicked at ')
    || haystack.includes('browser.rs:')
    || haystack.includes('recursive use of an object detected')
    || haystack.includes('unsafe aliasing in rust')
    || haystack.includes('attempted to take ownership of Rust value')
    || haystack.includes('memory access out of bounds')
    || haystack.includes('out of bounds')
    || haystack.includes('RuntimeError')
    || haystack.includes('unreachable')
}
