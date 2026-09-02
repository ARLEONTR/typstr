import { buildApiUrl } from './api/client'
// pandoc-wasm does not publish typings for its internal browser loader entrypoint.
// @ts-expect-error internal package loader is intentionally consumed as untyped JS
import { createPandocInstance } from '../node_modules/pandoc-wasm/src/core.js'
import pandocWasmUrl from '../node_modules/pandoc-wasm/src/pandoc.wasm?url'

interface PreviewWorkspaceFile {
  id?: string
  path: string
  content: string | Uint8Array
  mimeType?: string
}

interface SourceWorkspaceFile {
  id?: string
  path: string
  mimeType?: string
}

type PandocConvert = (
  options: Record<string, unknown>,
  stdin: string | null,
  files: Record<string, string | Blob>,
) => Promise<{
  stdout: string
  stderr: string
  warnings: unknown[]
  files: Record<string, string | Blob>
  mediaFiles: Record<string, Blob>
}>

let pandocConvertPromise: Promise<PandocConvert> | null = null

class PandocWasmPreviewError extends Error {
  rawLog: string | null

  constructor(message: string, rawLog: string | null) {
    super(message)
    this.name = 'PandocWasmPreviewError'
    this.rawLog = rawLog
  }
}

export function shouldUsePandocWasmForLatexPreview(source: string): boolean {
  if (detectTwoColumnLatexLayout(source)) {
    return false
  }

  return !hasComplexLatexFigures(source)
}

export async function convertLatexWorkspaceToHtmlWithPandocWasm(input: {
  projectId: string
  entryPath: string
  source: string
  files: PreviewWorkspaceFile[]
  sourceFiles: SourceWorkspaceFile[]
}): Promise<{ html: string; rawLog: string | null }> {
  const normalizedEntryPath = normalizeProjectRelativePath(input.entryPath)
  const browserFiles: Record<string, string | Blob> = {}

  for (const file of input.files) {
    const normalizedPath = normalizeProjectRelativePath(file.path)
    browserFiles[normalizedPath] = typeof file.content === 'string'
      ? file.content
      : new Blob([toArrayBuffer(file.content)], { type: file.mimeType || inferMimeTypeFromPath(normalizedPath) })
  }

  const bibliographyPaths = input.sourceFiles
    .map((file) => normalizeProjectRelativePath(file.path))
    .filter((filePath) => /\.bib$/i.test(filePath))
  const cslPath = input.sourceFiles
    .map((file) => normalizeProjectRelativePath(file.path))
    .find((filePath) => /\.csl$/i.test(filePath))

  const pandocConvert = await getPandocConvert()
  const result = await pandocConvert(
    {
      from: 'latex',
      to: 'html',
      standalone: true,
      citeproc: bibliographyPaths.length > 0,
      bibliography: bibliographyPaths.length > 0 ? bibliographyPaths : undefined,
      csl: cslPath,
      'html-math-method': 'mathjax',
      'input-files': [normalizedEntryPath],
    },
    null,
    browserFiles,
  )

  const stderr = result.stderr.trim()
  const rawLog = buildPandocWasmRawLog(result.stderr, result.warnings)
  if (stderr && /^error:/i.test(stderr)) {
    throw new PandocWasmPreviewError(stderr, rawLog)
  }

  if (!result.stdout.trim()) {
    throw new PandocWasmPreviewError(stderr || 'pandoc-wasm produced an empty HTML preview.', rawLog)
  }

  validatePandocWasmPreview(input.source, result.stdout, rawLog)

  const withResolvedAssets = rewritePreviewHtmlAssetUrls(result.stdout, input.projectId, normalizedEntryPath, input.sourceFiles)
  return {
    html: sanitizeLatexPreviewHtmlForSandbox(applyLatexPreviewLayoutHints(input.source, withResolvedAssets)),
    rawLog,
  }
}

export function sanitizeLatexPreviewHtmlForSandbox(html: string): string {
  let nextHtml = html

  nextHtml = nextHtml.replace(/\btarget=("|')(_parent|_top)\1/gi, 'target="_blank"')
  nextHtml = nextHtml.replace(/<base\b([^>]*)\btarget=("|')(_parent|_top)\2([^>]*)>/gi, '<base$1$3>')

  return nextHtml
}

function validatePandocWasmPreview(source: string, html: string, rawLog: string | null): void {
  const normalizedHtml = html.toLowerCase()
  const hasCitationCommands = /\\(cite|citet|citep|autocite|textcite|parencite)\b/i.test(source)
    || /\\bibliography\b/i.test(source)
    || /\\printbibliography\b/i.test(source)
    || /\\addbibresource\b/i.test(source)

  const hasRenderedReferences = normalizedHtml.includes('id="refs"')
    || normalizedHtml.includes('class="references"')
    || normalizedHtml.includes('class="csl-entry"')

  const looksLikeLiteralLatex = /<body[^>]*>[\s\S]*documentclass<span>/i.test(html)
    || /<body[^>]*>[\s\S]*begin<span>document/i.test(html)
    || /<body[^>]*>[\s\S]*bibliography<span>/i.test(html)

  if (looksLikeLiteralLatex) {
    throw new PandocWasmPreviewError('pandoc-wasm treated the LaTeX source as literal text.', rawLog)
  }

  if (hasCitationCommands && !hasRenderedReferences) {
    throw new PandocWasmPreviewError('pandoc-wasm did not render the bibliography for this LaTeX document.', rawLog)
  }
}

export function getPandocWasmRawLog(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'rawLog' in error && typeof (error as { rawLog?: unknown }).rawLog === 'string'
    ? (error as { rawLog: string }).rawLog
    : null
}

function buildPandocWasmRawLog(stderr: string, warnings: unknown[]): string | null {
  const sections: string[] = []
  const trimmedStderr = stderr.trim()
  if (trimmedStderr) {
    sections.push(trimmedStderr)
  }

  if (warnings.length > 0) {
    const warningText = warnings
      .map((warning) => {
        if (typeof warning === 'string') {
          return warning
        }
        try {
          return JSON.stringify(warning)
        } catch {
          return String(warning)
        }
      })
      .join('\n')
      .trim()

    if (warningText) {
      sections.push(`warnings:\n${warningText}`)
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

function hasComplexLatexFigures(source: string): boolean {
  return /\\begin\{figure\*?\}/i.test(source)
    || /\\begin\{subfigure\}/i.test(source)
    || /\\begin\{wrapfigure\}/i.test(source)
    || /\\includegraphics(?:\[[^\]]*\])?\s*\{/i.test(source)
    || /\\includepdf(?:\[[^\]]*\])?\s*\{/i.test(source)
    || /\\tikzpicture\b/i.test(source)
}

async function getPandocConvert(): Promise<PandocConvert> {
  if (!pandocConvertPromise) {
    pandocConvertPromise = (async () => {
      const response = await fetch(pandocWasmUrl)
      if (!response.ok) {
        throw new Error(`Failed to load pandoc.wasm: ${response.status} ${response.statusText}`)
      }

      const pandoc = await createPandocInstance(await response.arrayBuffer())
      return pandoc.convert as PandocConvert
    })()
  }

  return pandocConvertPromise
}

function rewritePreviewHtmlAssetUrls(
  html: string,
  projectId: string,
  entryFilePath: string,
  files: SourceWorkspaceFile[],
): string {
  const fileByPath = new Map<string, { id: string; mimeType: string }>()
  for (const file of files) {
    if (!file.id) {
      continue
    }
    fileByPath.set(normalizeProjectRelativePath(file.path), { id: file.id, mimeType: file.mimeType || inferMimeTypeFromPath(file.path) })
  }

  const entryDir = dirnamePosix(normalizeProjectRelativePath(entryFilePath))
  const replaceAttr = (attribute: 'src' | 'href', inputHtml: string) => {
    const pattern = new RegExp(`\\b${attribute}=(\"([^\"]*)\"|'([^']*)')`, 'gi')
    return inputHtml.replace(pattern, (full, quoted, dqValue, sqValue) => {
      const rawValue = (dqValue ?? sqValue ?? '').trim()
      if (!rawValue || isExternalPreviewUrl(rawValue)) {
        return full
      }

      const resolvedPath = resolvePreviewPath(entryDir, rawValue)
      const file = fileByPath.get(resolvedPath)
      if (!file) {
        return full
      }

      const replacement = buildApiUrl(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}/content`)
      return `${attribute}=${quoted[0]}${replacement}${quoted[0]}`
    })
  }

  const withResolvedUrls = replaceAttr('href', replaceAttr('src', html))
  return rewritePreviewHtmlEmbeddedPdfs(withResolvedUrls, projectId, entryDir, fileByPath)
}

function rewritePreviewHtmlEmbeddedPdfs(
  html: string,
  projectId: string,
  entryDir: string,
  fileByPath: Map<string, { id: string; mimeType: string }>,
): string {
  const resolvePreviewFile = (rawValue: string): { id: string; mimeType: string } | null => {
    if (!rawValue || isExternalPreviewUrl(rawValue)) {
      return null
    }

    const resolvedPath = resolvePreviewPath(entryDir, rawValue)
    return fileByPath.get(resolvedPath) ?? null
  }

  const buildPdfFigureReplacement = (fileId: string, label: string) => {
    const thumbnailUrl = buildApiUrl(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/thumbnail?width=1400&format=png`)
    const contentUrl = buildApiUrl(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/content`)
    return [
      '<figure class="typstr-pdf-figure">',
      `  <a href="${contentUrl}" target="_blank" rel="noreferrer">`,
      `    <img src="${thumbnailUrl}" alt="${escapeHtmlAttribute(label)}" loading="lazy" />`,
      '  </a>',
      `  <figcaption>${escapeHtmlText(label)} (PDF preview)</figcaption>`,
      '</figure>',
    ].join('')
  }

  let nextHtml = html.replace(/<object\b[^>]*\bdata=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/object>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, basenamePosix(rawValue) || 'Embedded PDF figure')
  })

  nextHtml = nextHtml.replace(/<embed\b[^>]*\bsrc=("([^"]*)"|'([^']*)')[^>]*>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, basenamePosix(rawValue) || 'Embedded PDF figure')
  })

  nextHtml = nextHtml.replace(/<iframe\b[^>]*\bsrc=("([^"]*)"|'([^']*)')[^>]*><\/iframe>/gi, (full, _quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const file = resolvePreviewFile(rawValue)
    if (!file || file.mimeType !== 'application/pdf') {
      return full
    }
    return buildPdfFigureReplacement(file.id, basenamePosix(rawValue) || 'Embedded PDF figure')
  })

  return nextHtml
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeProjectRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  const resolved: string[] = []

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }

  return resolved.join('/')
}

function isExternalPreviewUrl(value: string): boolean {
  const lowered = value.toLowerCase()
  return lowered.startsWith('http://')
    || lowered.startsWith('https://')
    || lowered.startsWith('data:')
    || lowered.startsWith('blob:')
    || lowered.startsWith('#')
    || lowered.startsWith('//')
}

function applyLatexPreviewLayoutHints(source: string, html: string): string {
  const usesTwoColumn = detectTwoColumnLatexLayout(source)
  const styleBlock = [
    '<style data-typstr-layout-hint="latex-web-preview">',
    'html, body { margin: 0; padding: 0; }',
    'body {',
    '  max-width: 1180px;',
    '  margin: 0 auto;',
    '  padding: 28px 32px 40px;',
    '  color: var(--text-bright);',
    '  background: var(--editor-bg);',
    '  font-family: var(--editor-font);',
    '  line-height: 1.45;',
    '}',
    'main, article, .body, .content, #content { max-width: 100%; }',
    'p { orphans: 3; widows: 3; }',
    'img, svg, table, pre, figure {',
    '  max-width: 100%;',
    '  height: auto;',
    '}',
    'figure, table, pre, blockquote {',
    '  break-inside: avoid;',
    '  page-break-inside: avoid;',
    '}',
    'figure { margin: 1rem 0; text-align: center; }',
    'figcaption { font-size: 0.95rem; color: var(--text-soft); margin-top: 0.5rem; }',
    '.typstr-pdf-figure img { display: block; width: 100%; max-width: min(100%, 720px); margin: 0 auto; border: 1px solid var(--panel-border); box-shadow: var(--surface-shadow-soft); }',
    'table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }',
    'th, td { border: 1px solid var(--panel-border); padding: 0.35rem 0.5rem; vertical-align: top; }',
    'blockquote { border-left: 3px solid var(--panel-border); margin: 1rem 0; padding: 0.25rem 0 0.25rem 1rem; color: var(--text-soft); }',
    'a { color: var(--accent); text-decoration: none; }',
    'a:hover { text-decoration: underline; }',
    'h1, h2, h3, h4, h5, h6 { break-after: avoid; color: var(--text-bright); line-height: 1.2; }',
    'h1.title { text-align: center; margin-bottom: 0.4rem; }',
    '.author, .date { text-align: center; color: var(--muted-text); }',
    '.abstract, .abstract p { font-size: 0.96rem; }',
    '.references, #refs { margin-top: 2rem; }',
    '#refs .csl-entry, .references li { margin-bottom: 0.55rem; }',
    usesTwoColumn
      ? 'body { column-count: 2; column-gap: 2.25rem; column-fill: balance; }'
      : 'body { column-count: 1; }',
    usesTwoColumn
      ? 'h1.title, .author, .date, .abstract, .bibliography, .references, #refs, figure, table { column-span: all; }'
      : '',
    usesTwoColumn
      ? 'h1, h2, h3, h4, h5, h6, p, ul, ol { break-inside: avoid-column; }'
      : '',
    '@media (max-width: 900px) { body { column-count: 1 !important; padding: 18px 16px 24px; } }',
    '</style>',
  ].join('')

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${styleBlock}`)
  }

  return `${styleBlock}${html}`
}

function detectTwoColumnLatexLayout(source: string): boolean {
  const documentClassMatch = source.match(/\\documentclass\s*(\[([^\]]*)\])?\s*\{([^}]+)\}/i)
  const options = (documentClassMatch?.[2] ?? '').toLowerCase().split(',').map((part) => part.trim()).filter(Boolean)
  const className = (documentClassMatch?.[3] ?? '').toLowerCase().trim()
  const lowerSource = source.toLowerCase()

  if (options.includes('twocolumn') || /\\twocolumn\b/i.test(source)) {
    return true
  }

  if (className === 'ieeetran') {
    return true
  }

  if (className === 'acmart' && options.some((option) => /^(sigconf|siggraph|sigplan|sigchi|acmcp)$/i.test(option))) {
    return true
  }

  return /\\begin\{multicols\}\{2\}/i.test(source) || lowerSource.includes('conference') && className === 'llncs'
}

function inferMimeTypeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.bib')) return 'text/plain'
  if (lower.endsWith('.csl')) return 'application/xml'
  return 'application/octet-stream'
}

function dirnamePosix(filePath: string): string {
  const normalized = normalizeProjectRelativePath(filePath)
  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return ''
  }
  return normalized.slice(0, lastSlashIndex)
}

function basenamePosix(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const lastSlashIndex = normalized.lastIndexOf('/')
  return lastSlashIndex === -1 ? normalized : normalized.slice(lastSlashIndex + 1)
}

function resolvePreviewPath(entryDir: string, rawValue: string): string {
  const base = entryDir ? `${entryDir}/${rawValue}` : rawValue
  return normalizeProjectRelativePath(base)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
