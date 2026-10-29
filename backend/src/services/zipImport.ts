import path from 'node:path'
import JSZip from 'jszip'

// Limits for project archives. The archive itself is capped by the upload
// limit; these stop small archives that expand to huge or countless files.
export const ZIP_IMPORT_MAX_ENTRIES = 5000
export const ZIP_IMPORT_MAX_ENTRY_BYTES = 200 * 1024 * 1024
export const ZIP_IMPORT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024

export class ZipImportError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'ZIP_IMPORT_INVALID') {
    super(message)
    this.name = 'ZipImportError'
    this.status = status
    this.code = code
  }
}

export interface ZipImportEntry {
  path: string
  isDirectory: boolean
  read: () => Promise<Buffer>
}

// Windows Explorer and older archivers store names in the OEM code page
// without the UTF-8 flag. Names that are not valid UTF-8 are read as CP857
// (Turkish OEM), which matches CP437 outside the Turkish letters.
const CP857_HIGH = 'ÇüéâäàåçêëèïîıÄÅÉæÆôöòûùİÖÜø£ØŞşáíóúñÑĞğ¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ºªÊËÈ╒ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµτ×ÚÛÙìÿ¯´­±≥¾¶§÷¸°¨·¹³²■ '
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeZipFileName(bytes: string[] | Uint8Array | Buffer): string {
  const data = typeof bytes[0] === 'string'
    ? Uint8Array.from((bytes as string[]).map((char) => char.charCodeAt(0)))
    : Uint8Array.from(bytes as Uint8Array)
  try {
    return strictUtf8.decode(data)
  } catch {
    let name = ''
    for (const byte of data) {
      name += byte < 0x80 ? String.fromCharCode(byte) : CP857_HIGH[byte - 0x80]
    }
    return name
  }
}

export function normalizeZipPath(input: string): string | null {
  const normalized = path.posix.normalize(input.replace(/\\/g, '/')).replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized || normalized === '.' || normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
    return null
  }
  if (/[\u0000-\u001f]/.test(normalized)) {
    return null
  }
  return normalized
}

const IGNORED_SEGMENTS = new Set(['__MACOSX', '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules'])
const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
// LaTeX and Typst build by-products; they are regenerated on compile and only
// clutter the file tree (and stale .aux files can break the first build).
const BUILD_ARTIFACT = /\.(aux|log|fls|fdb_latexmk|synctex|synctex\.gz|synctex\(busy\)|blg|bcf|run\.xml|xdv|toc|lof|lot|out|nav|snm|vrb)$/i

export function isIgnoredZipPath(normalizedPath: string): boolean {
  const segments = normalizedPath.split('/')
  const name = segments[segments.length - 1]
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return true
  if (IGNORED_NAMES.has(name.toLowerCase()) || name.startsWith('._')) return true
  return BUILD_ARTIFACT.test(name)
}

export function detectZipTopLevelPrefix(names: string[]): string | null {
  if (names.length === 0) return null
  const first = names[0].split('/')[0]
  if (!names.every((name) => name.startsWith(`${first}/`))) return null
  return `${first}/`
}

function readCapped(entry: JSZip.JSZipObject, maxBytes: number, onBytes: (count: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const stream = entry.nodeStream('nodebuffer')
    stream.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      try {
        if (size > maxBytes) {
          throw new ZipImportError(`${entry.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, 413, 'ZIP_IMPORT_TOO_LARGE')
        }
        onBytes(chunk.length)
      } catch (error) {
        done = true
        stream.pause()
        reject(error)
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', (error) => {
      if (done) return
      done = true
      reject(new ZipImportError(`Could not read ${entry.name} from the archive: ${error instanceof Error ? error.message : String(error)}`))
    })
    stream.on('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks, size))
    })
  })
}

/**
 * Open a project archive and list its usable entries without extracting them.
 * Paths are normalised, a single wrapping folder is removed, and OS metadata,
 * VCS folders and build by-products are skipped. Rejects archives that are
 * corrupt, empty, or expand beyond the import limits.
 */
export async function openProjectZip(buffer: Buffer): Promise<ZipImportEntry[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer, { decodeFileName: decodeZipFileName })
  } catch {
    throw new ZipImportError('The file is not a valid ZIP archive')
  }

  const rawEntries = Object.values(zip.files)
  if (rawEntries.length > ZIP_IMPORT_MAX_ENTRIES) {
    throw new ZipImportError(`The archive has more than ${ZIP_IMPORT_MAX_ENTRIES} entries`, 413, 'ZIP_IMPORT_TOO_LARGE')
  }

  const candidates: Array<{ path: string; entry: JSZip.JSZipObject }> = []
  for (const entry of rawEntries) {
    const normalized = normalizeZipPath(entry.name)
    if (!normalized || isIgnoredZipPath(normalized)) continue
    candidates.push({ path: normalized, entry })
  }

  const prefix = detectZipTopLevelPrefix(candidates.filter(({ entry }) => !entry.dir).map(({ path: name }) => name))
  let totalBytes = 0
  const countBytes = (count: number) => {
    totalBytes += count
    if (totalBytes > ZIP_IMPORT_MAX_TOTAL_BYTES) {
      throw new ZipImportError(`The archive expands to more than ${Math.round(ZIP_IMPORT_MAX_TOTAL_BYTES / 1024 / 1024)} MB`, 413, 'ZIP_IMPORT_TOO_LARGE')
    }
  }

  const seen = new Set<string>()
  const entries: ZipImportEntry[] = []
  for (const { path: fullPath, entry } of candidates) {
    const relative = prefix ? (fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : '') : fullPath
    if (!relative || seen.has(relative)) continue
    seen.add(relative)
    entries.push({
      path: relative,
      isDirectory: entry.dir,
      read: () => readCapped(entry, ZIP_IMPORT_MAX_ENTRY_BYTES, countBytes),
    })
  }

  if (!entries.some((entry) => !entry.isDirectory)) {
    throw new ZipImportError('The archive contains no project files')
  }

  // Parents before children, so folders exist before the files inside them.
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

const windows1254 = new TextDecoder('windows-1254')

/** Decode a text file, falling back to Windows-1254 for legacy Turkish sources. */
export function decodeProjectText(content: Buffer): string {
  try {
    return strictUtf8.decode(content)
  } catch {
    return windows1254.decode(content)
  }
}
