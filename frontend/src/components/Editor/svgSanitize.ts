// Compiled preview pages are inserted into the app's own document, so a
// document must not be able to smuggle script into them. Typst copies link
// targets verbatim (#link("javascript:...") becomes <a href="javascript:...">),
// which would run in typstr's origin when a collaborator clicks it.

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' }

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

export function isSafePreviewHref(value: string): boolean {
  // Browsers ignore ASCII whitespace and control characters inside a scheme.
  // eslint-disable-next-line no-control-regex
  const href = decodeEntities(value).replace(/[\u0000- \u007f]+/g, '').toLowerCase()
  const colon = href.indexOf(':')
  if (colon === -1) return true
  const firstDelimiter = href.search(/[/?#]/)
  if (firstDelimiter !== -1 && firstDelimiter < colon) return true
  return /^(?:https?|mailto):/.test(href) || /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/.test(href)
}

export function sanitizePreviewSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, '')
    .replace(/<foreignObject\b[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, '')
    .replace(/<[a-z][^>]*>/gi, (tag) => tag
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(\s(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*')/gi, (attribute, prefix: string, quoted: string) => (
        isSafePreviewHref(quoted.slice(1, -1)) ? attribute : `${prefix}"#"`
      )))
}
