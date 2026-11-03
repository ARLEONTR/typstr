import type * as Y from 'yjs'

/**
 * Makes `text` read `content` by replacing only the part that differs, so a
 * collaborator's concurrent edit elsewhere keeps its place. Call it inside a
 * transaction. Never splits a surrogate pair: Yjs encodes each piece as
 * UTF-8, which would turn half a pair into U+FFFD.
 */
export function replaceYText(text: Y.Text, content: string): void {
  const current = text.toString()
  if (current === content) {
    return
  }

  const shorter = Math.min(current.length, content.length)
  let start = 0
  while (start < shorter && current.charCodeAt(start) === content.charCodeAt(start)) {
    start += 1
  }
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) {
    start -= 1
  }

  let end = 0
  while (end < shorter - start && current.charCodeAt(current.length - 1 - end) === content.charCodeAt(content.length - 1 - end)) {
    end += 1
  }
  if (end > 0 && isLowSurrogate(current.charCodeAt(current.length - end))) {
    end -= 1
  }

  text.delete(start, current.length - start - end)
  text.insert(start, content.slice(start, content.length - end))
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
