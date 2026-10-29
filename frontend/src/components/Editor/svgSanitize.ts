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

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// typst.ts puts an invisible copy of each text run in a <foreignObject> so the
// preview text can be selected and clicked (click-to-source needs it). Its
// HTML could carry markup, so rebuild it from the numbers and plain text only.
function rebuildTextLayer(element: string): string {
  const open = element.match(/^<foreignObject\b([^>]*)>/i)
  const inner = element.match(/<h5:div\b[^>]*\bclass="tsel"[^>]*>([\s\S]*?)<\/h5:div\s*>/i)
  if (!open || !inner) return ''
  const number = (name: string, source: string) => source.match(new RegExp(`\\b${name}="(-?[\\d.]+)"`))?.[1] ?? null
  const x = number('x', open[1])
  const y = number('y', open[1])
  const width = number('width', open[1])
  const height = number('height', open[1])
  if (x === null || y === null || width === null || height === null) return ''
  const fontSize = inner[0].match(/font-size:\s*([\d.]+)px/i)?.[1] ?? '16'
  const text = decodeEntities(inner[1].replace(/<[^>]*>/g, ''))
  return `<foreignObject x="${x}" y="${y}" width="${width}" height="${height}"><h5:div class="tsel" style="font-size: ${fontSize}px">${escapeText(text)}</h5:div></foreignObject>`
}

export function sanitizePreviewSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, '')
    .replace(/<foreignObject\b[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, rebuildTextLayer)
    .replace(/<[a-z][^>]*>/gi, (tag) => tag
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(\s(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*')/gi, (attribute, prefix: string, quoted: string) => (
        isSafePreviewHref(quoted.slice(1, -1)) ? attribute : `${prefix}"#"`
      )))
}
