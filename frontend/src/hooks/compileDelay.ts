// How long the live Typst preview waits after a keystroke before compiling.
// A document that compiles quickly keeps following every keystroke; one that
// takes long is compiled once the writer pauses, about half its compile time,
// so the browser does not compile it over and over while they type.
export const TYPST_AUTO_COMPILE_MIN_DELAY_MS = 16
export const TYPST_AUTO_COMPILE_MAX_DELAY_MS = 1200
const FAST_COMPILE_MS = 150

export function typstAutoCompileDelayFor(lastCompileMs: number | null | undefined): number {
  if (lastCompileMs == null || !Number.isFinite(lastCompileMs) || lastCompileMs <= FAST_COMPILE_MS) {
    return TYPST_AUTO_COMPILE_MIN_DELAY_MS
  }
  return Math.min(TYPST_AUTO_COMPILE_MAX_DELAY_MS, Math.round(lastCompileMs * 0.6))
}
