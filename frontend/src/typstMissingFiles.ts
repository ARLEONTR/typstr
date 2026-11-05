// Typst reports a file that the workspace does not have as "failed to load
// file (is a directory)", which sent people looking for a folder that was
// never there. The browser compiler notes the paths it could not find, and
// the error names them instead.
const IS_DIRECTORY_MESSAGE = 'failed to load file (is a directory)'

/** True when some workspace file lies below this path, i.e. it is a real folder. */
export function isVirtualDirectory(virtualFiles: { keys(): Iterable<string> }, relativePath: string): boolean {
  const prefix = `${relativePath.replace(/\/+$/, '')}/`
  for (const key of virtualFiles.keys()) {
    if (key.replace(/^\/+/, '').startsWith(prefix)) return true
  }
  return false
}

export function explainMissingFiles(error: unknown, missing: Iterable<string>): unknown {
  const paths = [...missing]
  if (paths.length === 0) return error
  const rewrite = (text: string) => text.split(IS_DIRECTORY_MESSAGE).join(`file not found in the project: ${paths.join(', ')}`)
  if (typeof error === 'string') return rewrite(error)
  if (Array.isArray(error)) return error.map((entry) => explainMissingFiles(entry, paths))
  if (error instanceof Error) {
    error.message = rewrite(error.message)
    return error
  }
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return { ...error, message: rewrite((error as { message: string }).message) }
  }
  return error
}
