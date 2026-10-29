// Text-based source <-> preview mapping for the Typst WebAssembly preview.
//
// The preview SVG has no source spans, but typst.ts adds an invisible text
// layer (one `.tsel` element per text run). A click there is mapped back by
// finding the clicked words in the project's sources, and a cursor position
// is mapped forward by finding the words around it in the preview's text.

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

const WORD = /[\p{L}\p{N}]+/gu

/** Source text with Typst emphasis markers removed and whitespace collapsed, mapped back to source offsets. */
function normalizeSource(text: string): { plain: string; offsets: number[] } {
  let plain = ''
  const offsets: number[] = []
  let lastWasSpace = true
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '*' || char === '_' || char === '\\') continue
    if (/\s/.test(char)) {
      if (lastWasSpace) continue
      plain += ' '
      offsets.push(index)
      lastWasSpace = true
      continue
    }
    plain += char
    offsets.push(index)
    lastWasSpace = false
  }
  return { plain, offsets }
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

/**
 * Map a click on preview text back to the source. `text` is the clicked text
 * run and `offset` the character clicked in it. Files are searched in order;
 * a wider window of words around the click is tried first, so the match is as
 * unique as possible.
 */
export function locateClickInSources(text: string, offset: number, files: SourceFile[]): SourceLocation | null {
  const words = [...text.matchAll(WORD)].map((match) => ({ start: match.index!, end: match.index! + match[0].length }))
  if (words.length === 0) return null
  let clicked = words.findIndex((word) => offset < word.end)
  if (clicked === -1) clicked = words.length - 1
  const normalizedFiles = files.map((file) => ({ file, ...normalizeSource(file.text) }))

  for (const radius of [3, 2, 1, 0]) {
    const first = words[Math.max(0, clicked - radius)]
    const last = words[Math.min(words.length - 1, clicked + radius)]
    const phrase = text.slice(first.start, last.end).replace(/\s+/g, ' ')
    if (radius > 0 && phrase.length < 6) continue
    for (const { file, plain, offsets } of normalizedFiles) {
      const index = plain.indexOf(phrase)
      if (index === -1) continue
      const within = Math.min(Math.max(0, offset - first.start), phrase.length - 1)
      const sourceOffset = offsets[index + within] ?? offsets[index]
      return { fileId: file.id, ...lineColumnAt(file.text, sourceOffset) }
    }
  }
  return null
}

/**
 * Phrases to look for in the preview for a cursor position, most specific
 * first. Markup (function calls, labels, references, math, comments) is
 * skipped; only words of running text are used.
 */
export function previewPhrasesAt(source: string, line: number, column: number): string[] {
  const lines = source.split('\n')
  const lineText = lines[line - 1] ?? ''
  const code = lineText.replace(/\/\/.*$/, '')
  // Blank out markup so its words are not used.
  const masked = code
    .replace(/\$[^$]*\$/g, (match) => ' '.repeat(match.length))
    .replace(/<[\w:.-]+>/g, (match) => ' '.repeat(match.length))
    .replace(/[@#][\w.:-]+/g, (match) => ' '.repeat(match.length))
    .replace(/^\s*=+\s*/, (match) => ' '.repeat(match.length))
  const words = [...masked.matchAll(WORD)].map((match) => ({ start: match.index!, end: match.index! + match[0].length }))
  if (words.length === 0) return []
  const cursor = column - 1
  let at = words.findIndex((word) => cursor < word.end)
  if (at === -1) at = words.length - 1

  const phrases: string[] = []
  for (const radius of [3, 2, 1]) {
    const first = words[Math.max(0, at - radius)]
    const last = words[Math.min(words.length - 1, at + radius)]
    const phrase = code.slice(first.start, last.end).replace(/[*_\\]/g, '').replace(/\s+/g, ' ').trim()
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase)
  }
  const word = code.slice(words[at].start, words[at].end)
  if (word.length >= 4 && !phrases.includes(word)) phrases.push(word)
  return phrases
}

/** Plain text of each preview page's text layer, whitespace collapsed. */
export function previewPageText(svg: string): string {
  const runs = [...svg.matchAll(/<h5:div\b[^>]*class="tsel"[^>]*>([\s\S]*?)<\/h5:div>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))
  return runs.join(' ').replace(/\s+/g, ' ')
}

/** The page whose text contains one of the phrases, preferring pages near `nearPage`. */
export function findPreviewPage(pageTexts: string[], phrases: string[], nearPage: number): { page: number; phrase: string } | null {
  for (const phrase of phrases) {
    let best: number | null = null
    pageTexts.forEach((text, page) => {
      if (text.includes(phrase) && (best === null || Math.abs(page - nearPage) < Math.abs(best - nearPage))) {
        best = page
      }
    })
    if (best !== null) return { page: best, phrase }
  }
  return null
}
