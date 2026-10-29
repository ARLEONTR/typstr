// Text-based source <-> preview mapping for the Typst WebAssembly preview.
//
// The preview SVG has no source spans, but typst.ts adds an invisible text
// layer (one `.tsel` element per text run). Both sides are reduced to running
// text: the sources by inlining `#include`d files into the main document and
// blanking out markup, the preview by joining its text runs in page order. A
// position is mapped by taking the words around it and finding the same
// occurrence (the k-th time those words appear) on the other side, so repeated
// phrases and sub-documents map to the right place.

export interface SourceFile {
  id: string
  path: string
  text: string
}

export interface SourceLocation {
  fileId: string
  line: number
  column: number
}

export interface PreviewLocation {
  page: number
  run: number
}

const WORD = /[\p{L}\p{N}]+/gu

// ── Preview side ──────────────────────────────────────────────────────────

function decodeHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/** Text runs of one preview page, in document order. */
export function previewRuns(svg: string): string[] {
  return [...svg.matchAll(/<h5:div\b[^>]*class="tsel"[^>]*>([\s\S]*?)<\/h5:div>/g)].map((match) => decodeHtml(match[1]))
}

export interface PreviewIndex {
  text: string
  /** Global start of every run, per page. */
  runStarts: number[][]
}

export function buildPreviewIndex(pages: string[]): PreviewIndex {
  let text = ''
  const runStarts = pages.map((svg) => previewRuns(svg).map((run) => {
    const start = text.length
    text += `${run.replace(/\s+/g, ' ')} `
    return start
  }))
  return { text, runStarts }
}

function previewLocationAt(index: PreviewIndex, position: number): PreviewLocation | null {
  let found: PreviewLocation | null = null
  index.runStarts.forEach((starts, page) => starts.forEach((start, run) => {
    if (start <= position) found = { page, run }
  }))
  return found
}

// ── Source side ───────────────────────────────────────────────────────────

export interface SourceIndex {
  text: string
  /** For every character of `text`, the file and offset it came from. */
  origin: Array<{ fileId: string; offset: number }>
}

function resolveIncludePath(fromPath: string, target: string): string {
  const base = target.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  for (const part of target.replace(/^\/+/, '').split('/')) {
    if (part === '..') base.pop()
    else if (part && part !== '.') base.push(part)
  }
  return base.join('/')
}

/** Blank out what does not render as running text, keeping offsets. */
function maskMarkup(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ')
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/\$[^$]*\$/g, blank)
    .replace(/<[\w:.-]+>/g, blank)
    .replace(/[@#][\w.:-]+/g, blank)
    .replace(/^[ \t]*=+[ \t]*/gm, blank)
    .replace(/[*_\\]/g, ' ')
}

/**
 * The main document's running text with every `#include` inlined, mapped back
 * to the file and offset of each character.
 */
export function buildSourceIndex(entryPath: string, files: SourceFile[]): SourceIndex {
  const byPath = new Map(files.map((file) => [file.path.replace(/^\/+/, ''), file]))
  const flat: Array<{ char: string; fileId: string; offset: number }> = []

  const visit = (path: string, depth: number, active: Set<string>) => {
    const file = byPath.get(path)
    if (!file || depth > 16 || active.has(path)) return
    active.add(path)
    const masked = maskMarkup(file.text)
    const include = /#include\s+"([^"]+)"/g
    let cursor = 0
    for (let match = include.exec(file.text); match; match = include.exec(file.text)) {
      for (let index = cursor; index < match.index; index += 1) flat.push({ char: masked[index], fileId: file.id, offset: index })
      flat.push({ char: ' ', fileId: file.id, offset: match.index })
      visit(resolveIncludePath(path, match[1]), depth + 1, active)
      flat.push({ char: ' ', fileId: file.id, offset: match.index + match[0].length })
      cursor = match.index + match[0].length
    }
    for (let index = cursor; index < file.text.length; index += 1) flat.push({ char: masked[index], fileId: file.id, offset: index })
    active.delete(path)
  }
  visit(entryPath.replace(/^\/+/, ''), 0, new Set())

  // Collapse whitespace so it lines up with the preview's text.
  let text = ''
  const origin: SourceIndex['origin'] = []
  let lastWasSpace = true
  for (const entry of flat) {
    const isSpace = /\s/.test(entry.char)
    if (isSpace && lastWasSpace) continue
    text += isSpace ? ' ' : entry.char
    origin.push({ fileId: entry.fileId, offset: entry.offset })
    lastWasSpace = isSpace
  }
  return { text, origin }
}

// ── Matching ──────────────────────────────────────────────────────────────

/** Word windows around `position`, widest first, as [start, end) ranges. */
function windowsAround(text: string, position: number): Array<[number, number]> {
  const words = [...text.matchAll(WORD)].map((match) => [match.index!, match.index! + match[0].length] as [number, number])
  if (words.length === 0) return []
  let at = words.findIndex(([, end]) => position < end)
  if (at === -1) at = words.length - 1
  const windows: Array<[number, number]> = []
  for (const radius of [4, 3, 2, 1, 0]) {
    const first = words[Math.max(0, at - radius)]
    const last = words[Math.min(words.length - 1, at + radius)]
    if (radius > 0 && last[1] - first[0] < 8) continue
    windows.push([first[0], last[1]])
  }
  return windows
}

function occurrences(text: string, phrase: string): number[] {
  const found: number[] = []
  for (let index = text.indexOf(phrase); index !== -1; index = text.indexOf(phrase, index + 1)) found.push(index)
  return found
}

/**
 * Find `position` of `from` in `to`: the same occurrence of the surrounding
 * words, or, if the counts differ, the occurrence at the most similar
 * relative position. Returns the matching position in `to`.
 */
function mapPosition(from: string, position: number, to: string): number | null {
  for (const [start, end] of windowsAround(from, position)) {
    const phrase = from.slice(start, end)
    const targets = occurrences(to, phrase)
    if (targets.length === 0) continue
    const sources = occurrences(from, phrase)
    const rank = sources.indexOf(start)
    let target: number
    if (rank !== -1 && sources.length === targets.length) {
      target = targets[rank]
    } else {
      const relative = start / Math.max(1, from.length)
      target = targets.reduce((best, candidate) => (
        Math.abs(candidate / to.length - relative) < Math.abs(best / to.length - relative) ? candidate : best
      ))
    }
    return target + Math.min(position - start, end - start)
  }
  return null
}

function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** Preview click (page, run, character in the run) -> source location. */
export function previewToSource(
  preview: PreviewIndex,
  location: PreviewLocation & { offset: number },
  source: SourceIndex,
  files: SourceFile[],
): SourceLocation | null {
  const runStart = preview.runStarts[location.page]?.[location.run]
  if (runStart === undefined) return null
  const position = runStart + location.offset
  const mapped = mapPosition(preview.text, position, source.text)
  if (mapped === null) return null
  const origin = source.origin[Math.min(mapped, source.origin.length - 1)]
  const file = files.find((candidate) => candidate.id === origin?.fileId)
  return file ? { fileId: file.id, ...lineColumnAt(file.text, origin.offset) } : null
}

/** Source position (file, line, column) -> preview page and run. */
export function sourceToPreview(
  source: SourceIndex,
  fileId: string,
  fileText: string,
  line: number,
  column: number,
  preview: PreviewIndex,
): PreviewLocation | null {
  const lines = fileText.split('\n')
  let offset = 0
  for (let index = 0; index < line - 1 && index < lines.length; index += 1) offset += lines[index].length + 1
  offset += column - 1
  // The first indexed character of this file at or after the cursor.
  let position = -1
  for (let index = 0; index < source.origin.length; index += 1) {
    const origin = source.origin[index]
    if (origin.fileId === fileId && origin.offset >= offset) {
      position = index
      break
    }
  }
  if (position === -1) return null
  const mapped = mapPosition(source.text, position, preview.text)
  return mapped === null ? null : previewLocationAt(preview, mapped)
}
