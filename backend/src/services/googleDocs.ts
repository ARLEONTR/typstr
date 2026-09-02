import path from 'node:path'
import { google } from 'googleapis'
import sharp from 'sharp'
import { findUserById } from '../db.js'
import { env } from '../env.js'
import type { UserRecord } from '../types.js'
import type { ProjectWorkspace } from './projectWorkspace.js'
import { compileTypstProjectToSvg } from './compiler.js'
import { createBinaryFileInDrive, ensureDriveFilePublicUrl } from './drive.js'

interface GoogleDocsInlineSegment {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  code?: boolean
  linkUrl?: string | null
  equation?: boolean
}

interface GoogleDocsEditableBlock {
  type: 'paragraph' | 'heading' | 'equation' | 'image'
  text: string
  headingLevel: number | null
  listKind: 'bullet' | 'numbered' | null
  segments: GoogleDocsInlineSegment[]
  imageSource?: string
  imageKind?: 'figure' | 'table'
}

export interface UpdateGoogleDocsDocumentInput {
  content: string
  workspace?: ProjectWorkspace
  sourceEntryPath?: string
  assetParentId?: string
}

export interface GoogleDocsUpdateResult {
  documentId: string
  revisionId: string | null
  warnings: string[]
}

type InlineStyleState = Omit<GoogleDocsInlineSegment, 'text'>

type GoogleDocsParseContext = {
  warnings: string[]
  warnedCommands: Set<string>
}

function createParseContext(): GoogleDocsParseContext {
  return {
    warnings: [],
    warnedCommands: new Set<string>(),
  }
}

function warnSkippedCommand(context: GoogleDocsParseContext, commandName: string): void {
  if (context.warnedCommands.has(commandName)) {
    return
  }
  context.warnedCommands.add(commandName)
  context.warnings.push(`Skipped unsupported Typst command #${commandName} during Google Docs conversion.`)
}

function getOAuthClient(user: UserRecord) {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCallbackUrl) {
    throw new Error('Google OAuth is not configured')
  }

  if (!user.refreshToken) {
    const error = new Error(`User ${user.email} does not have a Google refresh token. Re-authentication is required.`) as Error & {
      code?: string
      status?: number
    }
    error.code = 'google_reauth_required'
    error.status = 401
    throw error
  }

  const client = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
  client.setCredentials({ refresh_token: user.refreshToken })
  return client
}

async function requireUser(userId: string): Promise<UserRecord> {
  const user = await findUserById(userId)
  if (!user) {
    throw new Error(`User ${userId} not found`)
  }

  return user
}

function getDocs(user: UserRecord) {
  return google.docs({ version: 'v1', auth: getOAuthClient(user) })
}

function normalizeTypstContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/#parbreak\(\)/g, '\n\n')
    .replace(/#linebreak\(\)/g, '\u2028')
}

function extractBalancedSegment(source: string, startIndex: number, openChar: string, closeChar: string): { value: string; endIndex: number } | null {
  if (source[startIndex] !== openChar) {
    return null
  }

  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) {
      continue
    }
    if (char === openChar) {
      depth += 1
      continue
    }
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) {
        return { value: source.slice(startIndex + 1, index), endIndex: index }
      }
    }
  }

  return null
}

function mergeInlineSegments(segments: GoogleDocsInlineSegment[]): GoogleDocsInlineSegment[] {
  const merged: GoogleDocsInlineSegment[] = []
  for (const segment of segments) {
    if (!segment.text) {
      continue
    }
    const previous = merged[merged.length - 1]
    if (
      previous
      && previous.bold === segment.bold
      && previous.italic === segment.italic
      && previous.underline === segment.underline
      && previous.code === segment.code
      && previous.equation === segment.equation
      && (previous.linkUrl ?? null) === (segment.linkUrl ?? null)
    ) {
      previous.text += segment.text
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

function parseLinkDestination(args: string): string | null {
  const quoted = args.match(/"([^"]+)"/)
  if (quoted?.[1]) {
    return quoted[1]
  }
  const trimmed = args.trim()
  return trimmed || null
}

function convertTypstMathToGoogleDocsSyntax(source: string): string {
  let next = source.trim()
  const superscriptMap: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
    '=': '⁼',
    '(': '⁽',
    ')': '⁾',
    n: 'ⁿ',
    i: 'ⁱ',
  }
  const subscriptMap: Record<string, string> = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
    '+': '₊',
    '-': '₋',
    '=': '₌',
    '(': '₍',
    ')': '₎',
    a: 'ₐ',
    e: 'ₑ',
    h: 'ₕ',
    i: 'ᵢ',
    j: 'ⱼ',
    k: 'ₖ',
    l: 'ₗ',
    m: 'ₘ',
    n: 'ₙ',
    o: 'ₒ',
    p: 'ₚ',
    r: 'ᵣ',
    s: 'ₛ',
    t: 'ₜ',
    u: 'ᵤ',
    v: 'ᵥ',
    x: 'ₓ',
  }
  const toRaisedText = (value: string, map: Record<string, string>, fallbackPrefix: string): string => {
    const converted = [...value].map((char) => map[char]).join('')
    return converted.length === value.length ? converted : `${fallbackPrefix}(${value})`
  }
  const replacements: Array<[RegExp, string]> = [
    [/\.\.\./g, '…'],
    [/->/g, '→'],
    [/<-/g, '←'],
    [/=>/g, '⇒'],
    [/<=>/g, '⇔'],
    [/<=/g, '≤'],
    [/>=/g, '≥'],
    [/!=/g, '≠'],
    [/\+-/g, '±'],
    [/-\+/g, '∓'],
    [/\* /g, '· '],
    [/ xx /g, ' × '],
    [/\binfty\b/g, '∞'],
    [/\bpartial\b/g, '∂'],
    [/\bnabla\b/g, '∇'],
    [/\bforall\b/g, '∀'],
    [/\bexists\b/g, '∃'],
    [/\bin\b/g, '∈'],
    [/\bnotin\b/g, '∉'],
    [/\bsubseteq\b/g, '⊆'],
    [/\bsupseteq\b/g, '⊇'],
    [/\bsubset\b/g, '⊂'],
    [/\bsupset\b/g, '⊃'],
    [/\bunion\b/g, '∪'],
    [/\binter\b/g, '∩'],
    [/\bRR\b/g, 'ℝ'],
    [/\bZZ\b/g, 'ℤ'],
    [/\bNN\b/g, 'ℕ'],
    [/\bQQ\b/g, 'ℚ'],
    [/\bpi\b/g, 'π'],
    [/\balpha\b/g, 'α'],
    [/\bbeta\b/g, 'β'],
    [/\bgamma\b/g, 'γ'],
    [/\bdelta\b/g, 'δ'],
    [/\btheta\b/g, 'θ'],
    [/\blambda\b/g, 'λ'],
    [/\bmu\b/g, 'μ'],
    [/\bsigma\b/g, 'σ'],
    [/\bSigma\b/g, 'Σ'],
    [/\bphi\b/g, 'φ'],
    [/\bomega\b/g, 'ω'],
    [/sum_/g, '∑_'],
    [/prod_/g, '∏_'],
    [/int_/g, '∫_'],
    [/oint_/g, '∮_'],
    [/sqrt/g, '√'],
  ]

  next = next.replace(/sqrt\(([^()]+)\)/g, '√($1)')
  next = next.replace(/root\(([^,]+),\s*([^()]+)\)/g, '($2)^(1/($1))')
  next = next.replace(/frac\(([^,]+),\s*([^()]+)\)/g, '($1)/($2)')
  next = next.replace(/binom\(([^,]+),\s*([^()]+)\)/g, '($1¦$2)')
  next = next.replace(/floor\(([^()]+)\)/g, '⌊$1⌋')
  next = next.replace(/ceil\(([^()]+)\)/g, '⌈$1⌉')
  next = next.replace(/abs\(([^()]+)\)/g, '|$1|')

  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement)
  }

  next = next.replace(/([A-Za-z0-9)\]])\^\(([^)]+)\)/g, (_, base: string, exponent: string) => `${base}${toRaisedText(exponent, superscriptMap, '^')}`)
  next = next.replace(/([A-Za-z0-9)\]])_\(([^)]+)\)/g, (_, base: string, subscript: string) => `${base}${toRaisedText(subscript, subscriptMap, '_')}`)
  next = next.replace(/([A-Za-z0-9)\]])\^([A-Za-z0-9+-]+)/g, (_, base: string, exponent: string) => `${base}${toRaisedText(exponent, superscriptMap, '^')}`)
  next = next.replace(/([A-Za-z0-9)\]])_([A-Za-z0-9+-]+)/g, (_, base: string, subscript: string) => `${base}${toRaisedText(subscript, subscriptMap, '_')}`)
  next = next.replace(/([A-Za-z])\.([A-Za-z])/g, '$1·$2')
  next = next.replace(/([0-9A-Za-z)])\s*\/\s*([0-9A-Za-z(])/g, '$1/$2')
  next = next.replace(/\b(sin|cos|tan|cot|sec|csc|log|ln|lim|max|min|det|Pr)\b/g, (_, fn: string) => fn)

  return next.replace(/\s+/g, ' ').trim()
}

function parseTypstInlineSegments(source: string, context: GoogleDocsParseContext, style: InlineStyleState = {}): GoogleDocsInlineSegment[] {
  const segments: GoogleDocsInlineSegment[] = []
  let buffer = ''

  const flushBuffer = () => {
    if (!buffer) {
      return
    }
    segments.push({ text: buffer.replace(/\u2028/g, '\n'), ...style })
    buffer = ''
  }

  let index = 0
  while (index < source.length) {
    if (source[index] === '$') {
      const endIndex = source.indexOf('$', index + 1)
      if (endIndex > index + 1) {
        flushBuffer()
        segments.push({ text: convertTypstMathToGoogleDocsSyntax(source.slice(index + 1, endIndex)), ...style, equation: true })
        index = endIndex + 1
        continue
      }
    }

    if (source[index] !== '#') {
      buffer += source[index]
      index += 1
      continue
    }

    const tryWrapper = (prefix: string, nextStyle: InlineStyleState): boolean => {
      if (!source.startsWith(prefix, index)) {
        return false
      }
      const bracket = extractBalancedSegment(source, index + prefix.length - 1, '[', ']')
      if (!bracket) {
        return false
      }
      flushBuffer()
      segments.push(...parseTypstInlineSegments(bracket.value, context, { ...style, ...nextStyle }))
      index = bracket.endIndex + 1
      return true
    }

    if (tryWrapper('#strong[', { bold: true })) continue
    if (tryWrapper('#emph[', { italic: true })) continue
    if (tryWrapper('#underline[', { underline: true })) continue
    if (tryWrapper('#raw[', { code: true })) continue

    if (source.startsWith('#linebreak()', index)) {
      buffer += '\n'
      index += '#linebreak()'.length
      continue
    }

    if (source.startsWith('#link(', index)) {
      const args = extractBalancedSegment(source, index + '#link'.length, '(', ')')
      if (args) {
        const url = parseLinkDestination(args.value)
        const labelStart = args.endIndex + 1
        const label = source[labelStart] === '[' ? extractBalancedSegment(source, labelStart, '[', ']') : null
        flushBuffer()
        if (label) {
          segments.push(...parseTypstInlineSegments(label.value, context, { ...style, linkUrl: url }))
          index = label.endIndex + 1
          continue
        }
        segments.push({ text: url ?? args.value, ...style, linkUrl: url })
        index = args.endIndex + 1
        continue
      }
    }

    const genericMatch = source.slice(index).match(/^#([a-zA-Z][\w-]*)/)
    if (genericMatch) {
      const commandName = genericMatch[1]
      const macroEnd = index + genericMatch[0].length
      const args = source[macroEnd] === '(' ? extractBalancedSegment(source, macroEnd, '(', ')') : null
      const contentStart = args ? args.endIndex + 1 : macroEnd
      const content = source[contentStart] === '[' ? extractBalancedSegment(source, contentStart, '[', ']') : null
      flushBuffer()
      warnSkippedCommand(context, commandName)
      if (content) {
        index = content.endIndex + 1
        continue
      }
      if (args) {
        index = args.endIndex + 1
        continue
      }
      index = macroEnd
      continue
    }

    buffer += source[index]
    index += 1
  }

  flushBuffer()
  return mergeInlineSegments(segments)
}

function isLineStart(source: string, index: number): boolean {
  let cursor = index - 1
  while (cursor >= 0 && source[cursor] !== '\n') {
    if (!/\s/.test(source[cursor])) {
      return false
    }
    cursor -= 1
  }
  return true
}

function skipLineIndent(source: string, index: number): number {
  let cursor = index
  while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t')) {
    cursor += 1
  }
  return cursor
}

function extractBlockEquation(source: string, startIndex: number): { value: string; endIndex: number } | null {
  const contentStart = skipLineIndent(source, startIndex)
  if (source[contentStart] !== '$' || !isLineStart(source, startIndex)) {
    return null
  }

  for (let index = contentStart + 1; index < source.length; index += 1) {
    if (source[index] !== '$') {
      continue
    }
    const value = source.slice(contentStart + 1, index).trim()
    if (!value) {
      return null
    }
    let tail = index + 1
    while (tail < source.length && source[tail] !== '\n') {
      if (!/\s/.test(source[tail])) {
        return null
      }
      tail += 1
    }
    return { value, endIndex: index + 1 }
  }

  return null
}

function extractCommandBlock(source: string, startIndex: number, commandName: 'figure' | 'table'): { value: string; endIndex: number } | null {
  const contentStart = skipLineIndent(source, startIndex)
  const commandPrefix = `#${commandName}`
  if (!source.startsWith(commandPrefix, contentStart) || !isLineStart(source, startIndex)) {
    return null
  }

  let cursor = contentStart + commandPrefix.length
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1
  }

  const args = source[cursor] === '(' ? extractBalancedSegment(source, cursor, '(', ')') : null
  if (args) {
    cursor = args.endIndex + 1
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1
    }
  }

  const body = source[cursor] === '[' ? extractBalancedSegment(source, cursor, '[', ']') : null
  if (!args && !body) {
    return null
  }

  const endIndex = body ? body.endIndex + 1 : args!.endIndex + 1
  return { value: source.slice(contentStart, endIndex), endIndex }
}

function buildEditableBlock(rawText: string, context: GoogleDocsParseContext, type: 'paragraph' | 'heading', headingLevel: number | null, listKind: 'bullet' | 'numbered' | null): GoogleDocsEditableBlock {
  const segments = parseTypstInlineSegments(rawText, context)
  return {
    text: segments.map((segment) => segment.text).join(''),
    type,
    headingLevel,
    listKind,
    segments,
  }
}

function parseEditableText(content: string): { blocks: GoogleDocsEditableBlock[]; warnings: string[] } {
  const normalized = normalizeTypstContent(content).trim()
  if (!normalized) {
    return { blocks: [], warnings: [] }
  }

  const context = createParseContext()
  const blocks: GoogleDocsEditableBlock[] = []
  const paragraphLines: string[] = []
  const flushParagraph = () => {
    const joined = paragraphLines.join(' ').trim()
    paragraphLines.length = 0
    if (!joined) {
      return
    }
    blocks.push(buildEditableBlock(joined, context, 'paragraph', null, null))
  }

  for (let offset = 0; offset < normalized.length;) {
    const remainder = normalized.slice(offset)
    const newlineIndex = remainder.indexOf('\n')
    const rawLine = newlineIndex === -1 ? remainder : remainder.slice(0, newlineIndex)
    const nextOffset = newlineIndex === -1 ? normalized.length : offset + newlineIndex + 1
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      offset = nextOffset
      continue
    }

    const equation = extractBlockEquation(normalized, offset)
    if (equation) {
      flushParagraph()
      const equationText = convertTypstMathToGoogleDocsSyntax(equation.value)
      blocks.push({
        text: equationText,
        type: 'equation',
        headingLevel: null,
        listKind: null,
        segments: [{ text: equationText, equation: true }],
      })
      offset = equation.endIndex
      while (offset < normalized.length && /[ \t]/.test(normalized[offset])) {
        offset += 1
      }
      if (normalized[offset] === '\n') {
        offset += 1
      }
      continue
    }

    const figure = extractCommandBlock(normalized, offset, 'figure')
    if (figure) {
      flushParagraph()
      blocks.push({
        text: '',
        type: 'image',
        headingLevel: null,
        listKind: null,
        segments: [],
        imageSource: figure.value,
        imageKind: 'figure',
      })
      offset = figure.endIndex
      while (offset < normalized.length && /[ \t]/.test(normalized[offset])) {
        offset += 1
      }
      if (normalized[offset] === '\n') {
        offset += 1
      }
      continue
    }

    const table = extractCommandBlock(normalized, offset, 'table')
    if (table) {
      flushParagraph()
      blocks.push({
        text: '',
        type: 'image',
        headingLevel: null,
        listKind: null,
        segments: [],
        imageSource: table.value,
        imageKind: 'table',
      })
      offset = table.endIndex
      while (offset < normalized.length && /[ \t]/.test(normalized[offset])) {
        offset += 1
      }
      if (normalized[offset] === '\n') {
        offset += 1
      }
      continue
    }

    const headingMatch = line.match(/^(={1,6})\s+([^=][\s\S]*)$/)
    if (headingMatch) {
      flushParagraph()
      blocks.push(buildEditableBlock(headingMatch[2].trim(), context, 'heading', headingMatch[1].length, null))
      offset = nextOffset
      continue
    }

    const bulletMatch = line.match(/^[-*]\s+([\s\S]+)$/)
    if (bulletMatch) {
      flushParagraph()
      blocks.push(buildEditableBlock(bulletMatch[1].trim(), context, 'paragraph', null, 'bullet'))
      offset = nextOffset
      continue
    }

    const numberedMatch = line.match(/^\+\s+([\s\S]+)$/)
    if (numberedMatch) {
      flushParagraph()
      blocks.push(buildEditableBlock(numberedMatch[1].trim(), context, 'paragraph', null, 'numbered'))
      offset = nextOffset
      continue
    }

    paragraphLines.push(line)
    offset = nextOffset
  }

  flushParagraph()
  return { blocks, warnings: context.warnings }
}

function buildTextStyleRequest(startIndex: number, endIndex: number, segment: GoogleDocsInlineSegment): Record<string, unknown> | null {
  if (endIndex <= startIndex) {
    return null
  }

  const textStyle: Record<string, unknown> = {}
  const fields: string[] = []

  if (segment.bold) {
    textStyle.bold = true
    fields.push('bold')
  }
  if (segment.italic) {
    textStyle.italic = true
    fields.push('italic')
  }
  if (segment.underline) {
    textStyle.underline = true
    fields.push('underline')
  }
  if (segment.linkUrl) {
    textStyle.link = { url: segment.linkUrl }
    fields.push('link')
  }
  if (segment.code) {
    textStyle.weightedFontFamily = { fontFamily: 'Courier New', weight: 400 }
    textStyle.backgroundColor = { color: { rgbColor: { red: 0.96, green: 0.96, blue: 0.96 } } }
    fields.push('weightedFontFamily', 'backgroundColor')
  }
  if (segment.equation) {
    textStyle.weightedFontFamily = { fontFamily: 'Cambria Math', weight: 400 }
    fields.push('weightedFontFamily')
  }

  if (fields.length === 0) {
    return null
  }

  return {
    updateTextStyle: {
      range: { startIndex, endIndex },
      textStyle,
      fields: [...new Set(fields)].join(','),
    },
  }
}

async function renderSnippetToPng(workspace: ProjectWorkspace, sourceEntryPath: string, snippetSource: string, kind: 'figure' | 'table'): Promise<Buffer> {
  const snippetEntryPath = path.posix.join(path.posix.dirname(sourceEntryPath), `.typstr-gdoc-${kind}-${Date.now()}.typ`)
  const svgResult = await compileTypstProjectToSvg({
    entryPath: snippetEntryPath,
    files: [
      ...workspace.files.filter((file) => file.path !== snippetEntryPath),
      {
        path: snippetEntryPath,
        mimeType: 'text/plain',
        content: [
          '#set page(width: auto, height: auto, margin: 8pt)',
          '#set par(justify: false)',
          snippetSource,
          '',
        ].filter(Boolean).join('\n'),
      },
    ],
  })
  const svg = svgResult.pages[0]
  if (!svg) {
    throw new Error(`Failed to render Typst ${kind}`)
  }
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer()
}

function mapGoogleDocsError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const e = error as Record<string, any>
    const status: number = e?.response?.status ?? e?.status ?? 0
    const reason: string = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason ?? ''
    const message: string = e?.response?.data?.error?.message ?? e?.message ?? ''
    const loweredMessage = message.toLowerCase()

    if (status === 401 || reason === 'authError') {
      const authError = new Error('Google Docs authentication expired. Please sign in again.') as Error & { code?: string; status?: number }
      authError.code = 'google_reauth_required'
      authError.status = 401
      return authError
    }

    if (status === 403 && (reason === 'insufficientPermissions' || reason === 'forbidden' || loweredMessage.includes('permission') || loweredMessage.includes('scope'))) {
      const scopeError = new Error('Google Docs permission required. Please grant Docs access.') as Error & { code?: string; status?: number }
      scopeError.code = 'drive_scope_required'
      scopeError.status = 403
      return scopeError
    }

    if (status === 404) {
      const missingError = new Error('Google Docs document not found. It may have been deleted or moved.') as Error & { status?: number }
      missingError.status = 404
      return missingError
    }
  }

  return error instanceof Error ? error : new Error(String(error))
}

export async function updateGoogleDocsDocument(userId: string, documentId: string, input: UpdateGoogleDocsDocumentInput): Promise<GoogleDocsUpdateResult> {
  try {
    const docs = getDocs(await requireUser(userId))
    const parsedContent = parseEditableText(input.content)
    const editableBlocks = parsedContent.blocks
    const current = await docs.documents.get({ documentId })
    const bodyContent = current.data.body?.content ?? []
    const documentEndIndex = bodyContent[bodyContent.length - 1]?.endIndex ?? 1
    const deleteEndIndex = Math.max(1, documentEndIndex - 1)
    const requests: Array<Record<string, unknown>> = []

    if (deleteEndIndex > 1) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: deleteEndIndex },
        },
      })
    }

    let rangeStart = 1
    for (const block of editableBlocks) {
      if (block.type === 'image' && block.imageSource && input.workspace && input.sourceEntryPath && input.assetParentId) {
        const imagePng = await renderSnippetToPng(input.workspace, input.sourceEntryPath, block.imageSource, block.imageKind ?? 'figure')
        const imageId = await createBinaryFileInDrive({
          userId,
          parentId: input.assetParentId,
          name: `gdoc-${block.imageKind ?? 'figure'}-${Date.now()}.png`,
          mimeType: 'image/png',
          content: imagePng,
        })
        const imageUrl = await ensureDriveFilePublicUrl(userId, imageId)
        requests.push({ insertInlineImage: { location: { index: rangeStart }, uri: imageUrl } })
        rangeStart += 1
        requests.push({ insertText: { location: { index: rangeStart }, text: '\n' } })
        rangeStart += 1
        continue
      }

      const insertedText = `${block.text}\n`
      requests.push({ insertText: { location: { index: rangeStart }, text: insertedText } })
      const blockLength = block.text.length + 1

      if (block.type === 'heading') {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: rangeStart, endIndex: rangeStart + blockLength },
            paragraphStyle: { namedStyleType: `HEADING_${Math.min(Math.max(block.headingLevel ?? 1, 1), 6)}` },
            fields: 'namedStyleType',
          },
        })
      }

      if (block.type === 'equation') {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: rangeStart, endIndex: rangeStart + blockLength },
            paragraphStyle: { alignment: 'CENTER' },
            fields: 'alignment',
          },
        })
      }

      if (block.listKind) {
        requests.push({
          createParagraphBullets: {
            range: { startIndex: rangeStart, endIndex: rangeStart + blockLength },
            bulletPreset: block.listKind === 'numbered' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE',
          },
        })
      }

      let segmentStart = rangeStart
      for (const segment of block.segments) {
        const segmentEnd = segmentStart + segment.text.length
        const styleRequest = buildTextStyleRequest(segmentStart, segmentEnd, segment)
        if (styleRequest) {
          requests.push(styleRequest)
        }
        segmentStart = segmentEnd
      }

      rangeStart += blockLength
    }

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests,
      },
    })

    const updated = await docs.documents.get({ documentId })
    return {
      documentId,
      revisionId: updated.data.revisionId ?? null,
      warnings: parsedContent.warnings,
    }
  } catch (error) {
    throw mapGoogleDocsError(error)
  }
}
