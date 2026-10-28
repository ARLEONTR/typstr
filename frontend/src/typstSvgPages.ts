// typst.ts renders a whole document as one SVG (its renderSvg ignores the
// `window` option), with shared <style>/<defs> followed by one
// <g class="typst-page"> per page. Split that into standalone per-page SVGs
// so the document is rendered once instead of once per page.

type SvgChild = { start: number; end: number; openTag: string }

const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g

function topLevelChildren(svg: string, from: number, until: number): SvgChild[] {
  const children: SvgChild[] = []
  let depth = 0
  let current: SvgChild | null = null
  TAG_RE.lastIndex = from

  for (let match = TAG_RE.exec(svg); match && match.index < until; match = TAG_RE.exec(svg)) {
    const [tag, closing, name, , selfClosing] = match
    if (closing) {
      depth -= 1
      if (depth === 0 && current) {
        current.end = match.index + tag.length
        children.push(current)
        current = null
      }
      continue
    }

    if (depth === 0) current = { start: match.index, end: -1, openTag: tag }
    // Style and script bodies are raw text: skip straight to their end tag.
    if (!selfClosing && (name === 'style' || name === 'script')) {
      const close = svg.indexOf(`</${name}>`, TAG_RE.lastIndex)
      if (close === -1) return children
      TAG_RE.lastIndex = close + name.length + 3
      if (depth === 0 && current) {
        current.end = TAG_RE.lastIndex
        children.push(current)
        current = null
      }
      continue
    }

    if (selfClosing) {
      if (depth === 0 && current) {
        current.end = match.index + tag.length
        children.push(current)
        current = null
      }
      continue
    }
    depth += 1
  }

  return children
}

function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null
}

export function splitTypstSvgIntoPages(svg: string): string[] {
  const rootOpen = svg.match(/<svg\b(?:"[^"]*"|'[^']*'|[^'">])*>/)
  const rootClose = svg.lastIndexOf('</svg>')
  if (!rootOpen || rootOpen.index === undefined || rootClose === -1) return svg ? [svg] : []

  const bodyStart = rootOpen.index + rootOpen[0].length
  const children = topLevelChildren(svg, bodyStart, rootClose)
  const isPage = (child: SvgChild) => /\sclass="typst-page\b/.test(child.openTag)
  const pages = children.filter(isPage)
  if (pages.length === 0) return [svg]

  const sharedChildren = children.filter((child) => !isPage(child) && !child.openTag.startsWith('<script'))
  const glyphDefs = sharedChildren.find((child) => /^<defs\b[^>]*\sclass="glyph"/.test(child.openTag))
  const glyphs = new Map<string, string>()
  if (glyphDefs) {
    const innerStart = glyphDefs.start + glyphDefs.openTag.length
    const innerEnd = svg.lastIndexOf('</defs>', glyphDefs.end)
    for (const glyph of topLevelChildren(svg, innerStart, innerEnd)) {
      const id = attribute(glyph.openTag, 'id')
      if (id) glyphs.set(id, svg.slice(glyph.start, glyph.end))
    }
  }

  // Every page carries the style and clip paths, but only the glyphs it
  // references: copying all glyph definitions into every page made them
  // about half of the preview's size.
  const glyphsFor = (content: string): string => {
    const used = new Set<string>()
    const pending = [content]
    while (pending.length > 0) {
      for (const match of pending.pop()!.matchAll(/href="#([^"]+)"/g)) {
        const glyph = glyphs.get(match[1])
        if (glyph !== undefined && !used.has(match[1])) {
          used.add(match[1])
          pending.push(glyph)
        }
      }
    }
    return [...used].map((id) => glyphs.get(id)).join('')
  }
  const sharedFor = (content: string): string => sharedChildren.map((child) => (
    child === glyphDefs ? `${glyphDefs.openTag}${glyphsFor(content)}</defs>` : svg.slice(child.start, child.end)
  )).join('')
  const rootAttributes = rootOpen[0]
    .replace(/\s(?:viewBox|width|height|data-width|data-height)="[^"]*"/g, '')
    .replace(/^<svg\b/, '')
    .replace(/>$/, '')

  return pages.map((page) => {
    const width = attribute(page.openTag, 'data-page-width') ?? '0'
    const height = attribute(page.openTag, 'data-page-height') ?? '0'
    const offset = page.openTag.match(/transform="translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)"/)?.[1] ?? '0'
    const size = `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-width="${width}" data-height="${height}"`
    const content = svg.slice(page.start, page.end)
    return `<svg ${size}${rootAttributes}>${sharedFor(content)}<g transform="translate(0, ${-Number(offset)})">${content}</g></svg>`
  })
}
