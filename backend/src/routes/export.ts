import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { canAccessProject, getProjectById, getProjectFileById, getProjectFileForUser, listProjectFiles } from '../db.js'
import { runBackgroundJobAndWait } from '../services/reliability.js'
import { loadProjectWorkspace, loadProjectWorkspaceFiles } from '../services/projectWorkspace.js'
import { compileLatexProjectToPdf } from '../services/compiler.js'
import { compileTypstProjectPdf, convertWorkspaceFilesToTypst, convertWithPandoc } from '../services/exporter.js'
import { assertCanExportFormat } from '../services/billing.js'
import type { ExportRequest, ExportFormat, ProjectFormat } from '../types.js'

export const exportRouter = Router()

const VALID_FORMATS: ExportFormat[] = ['docx', 'latex', 'html', 'pdf']

// POST /api/export
// Body: { source: string, format: 'docx' | 'latex' | 'html' | 'pdf' }
// Response: binary file with Content-Disposition: attachment
exportRouter.post('/', async (req, res) => {
  const { source, format, documentFormat, projectId, fileId, saveToDrive } = req.body as ExportRequest

  if (typeof source !== 'string' || !source.trim()) {
    return res.status(400).json({ error: 'source must be a non-empty string' })
  }

  if (source.length > 2_000_000) {
    return res.status(400).json({ error: 'Source must be at most 2000000 characters' })
  }

  if (!VALID_FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${VALID_FORMATS.join(', ')}` })
  }

  if (documentFormat !== undefined && documentFormat !== 'typst' && documentFormat !== 'latex') {
    return res.status(400).json({ error: 'documentFormat must be typst or latex when provided' })
  }

  try {
    const user = getAuthenticatedUser(req)
    await assertCanExportFormat(user.id, format)
    const exportResult = await runBackgroundJobAndWait<any>('export-document', {
      userId: user.id,
      source,
      format,
      documentFormat,
      projectId,
      fileId,
      saveToDrive,
    }, { timeoutMs: 90_000 })

    if (saveToDrive) {
      return res.json(exportResult)
    }

    const { base64, mimeType, extension } = exportResult
    const buffer = Buffer.from(base64, 'base64')
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="document.${extension}"`)
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const typedError = err as { status?: number; code?: string; limitKey?: string; statusPayload?: unknown }
    if (typedError.status) {
      return res.status(typedError.status).json({
        error: message,
        code: typedError.code ?? null,
        limitKey: typedError.limitKey ?? null,
        billing: typedError.statusPayload ?? null,
      })
    }
    res.status(422).json({ error: message })
  }
})

exportRouter.post('/project-zip', async (req, res) => {
  const { projectId, fileId, source } = req.body as {
    projectId?: string
    fileId?: string
    source?: string
    targetProjectFormat?: ProjectFormat
  }

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' })
  }

  try {
    const archive = await buildProjectZip(req, {
      projectId,
      fileId,
      source,
      targetProjectFormat: req.body.targetProjectFormat,
    })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${archive.fileName}"`)
    res.setHeader('Content-Length', archive.buffer.length)
    res.send(archive.buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(422).json({ error: message })
  }
})

exportRouter.post('/arxiv-package', async (req, res) => {
  const {
    projectId,
    entryFileId,
    activeFileId,
    activeSource,
    archiveFormat,
    metadata,
  } = req.body as {
    projectId?: string
    entryFileId?: string
    activeFileId?: string
    activeSource?: string
    archiveFormat?: 'zip' | 'tar.gz'
    metadata?: Record<string, unknown>
  }

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' })
  }

  try {
    const archive = await buildArxivPackage(req, {
      projectId,
      entryFileId,
      activeFileId,
      activeSource,
      archiveFormat: archiveFormat === 'tar.gz' ? 'tar.gz' : 'zip',
      metadata: typeof metadata === 'object' && metadata ? metadata : {},
    })
    res.setHeader('Content-Type', archive.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${archive.fileName}"`)
    res.setHeader('Content-Length', archive.buffer.length)
    res.send(archive.buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(422).json({ error: message })
  }
})

exportRouter.get('/arxiv-lookup', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    return res.status(400).json({ error: 'q is required' })
  }

  try {
    const params = new URLSearchParams({
      max_results: '8',
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    })
    if (/^(?:arxiv:)?[A-Za-z0-9.\-]+(?:\/\d+)?(?:v\d+)?$/i.test(query) && /\d/.test(query)) {
      params.set('id_list', query.replace(/^arxiv:/i, ''))
    } else {
      params.set('search_query', `all:${query}`)
    }

    const response = await fetch(`https://export.arxiv.org/api/query?${params.toString()}`, {
      headers: { 'User-Agent': 'typstr arXiv metadata lookup' },
    })
    if (!response.ok) {
      return res.status(response.status).json({ error: `arXiv lookup returned ${response.status}` })
    }

    res.json({ results: parseArxivAtom(await response.text()) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(422).json({ error: message })
  }
})

async function buildProjectZip(
  req: any,
  input: {
    projectId: string
    fileId?: string
    source?: string
    targetProjectFormat?: ProjectFormat
  },
) {
  const user = getAuthenticatedUser(req)
  const hasAccess = await canAccessProject(input.projectId, user.id, 'viewer')
  if (!hasAccess) {
    throw new Error('Project access denied')
  }

  const project = await getProjectById(input.projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  const projectFiles = await listProjectFiles(input.projectId)
  const ownerUserId = project.ownerUserId
  const sourceOverride = typeof input.source === 'string' && input.source.trim() && input.fileId
    ? { fileId: input.fileId, content: input.source }
    : undefined

  const files = await loadProjectWorkspaceFiles({
    projectId: input.projectId,
    ownerUserId,
    sourceOverride,
  })

  const packagedFiles = input.targetProjectFormat === 'typst'
    ? await convertWorkspaceFilesToTypst(files)
    : files

  const zip = new JSZip()
  for (const file of packagedFiles) {
    zip.file(file.path, file.content)
  }

  const emptyFolders = projectFiles
    .filter((file) => file.mimeType === 'application/vnd.google-apps.folder')
    .map((file) => file.path)
    .filter((folderPath) => !files.some((file) => file.path.startsWith(`${folderPath}/`)))

  for (const folderPath of emptyFolders) {
    zip.folder(folderPath)
  }

  return {
    fileName: `${sanitizeFileName(project.title || 'project')}${input.targetProjectFormat === 'typst' ? '-typst' : ''}.zip`,
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }),
  }
}


async function buildArxivPackage(
  req: any,
  input: {
    projectId: string
    entryFileId?: string
    activeFileId?: string
    activeSource?: string
    archiveFormat: 'zip' | 'tar.gz'
    metadata: Record<string, unknown>
  },
) {
  const user = getAuthenticatedUser(req)
  if (!(await canAccessProject(input.projectId, user.id, 'viewer'))) {
    throw new Error('Project access denied')
  }

  const project = await getProjectById(input.projectId)
  if (!project) {
    throw new Error('Project not found')
  }

  const entryFile = input.entryFileId
    ? await getProjectFileForUser(input.entryFileId, user.id)
    : project.mainFileId
      ? await getProjectFileById(project.mainFileId)
      : null
  if (!entryFile || entryFile.projectId !== project.id || entryFile.mimeType === 'application/vnd.google-apps.folder') {
    throw new Error('Main manuscript file not found')
  }

  const workspace = await loadProjectWorkspace({
    projectId: project.id,
    ownerUserId: project.ownerUserId,
    entryFileId: entryFile.id,
    entryPath: entryFile.path,
    sourceOverride: input.activeFileId && typeof input.activeSource === 'string'
      ? { fileId: input.activeFileId, content: input.activeSource }
      : undefined,
  })

  const isLatex = /\.tex$/i.test(entryFile.path)
  const isTypst = /\.typ$/i.test(entryFile.path)
  const pdf = isLatex
    ? (await compileLatexProjectToPdf({ entryPath: workspace.entryPath, files: workspace.files })).pdf
    : isTypst
      ? (await compileTypstProjectPdf(workspace)).buffer
      : null
  if (!pdf) {
    throw new Error('arXiv package export requires a Typst or LaTeX manuscript entry file.')
  }

  const pathMap = buildCleanPathMap(workspace.files.map((file) => file.path))
  const packageFiles: Array<{ path: string; content: string | Buffer }> = []
  for (const file of workspace.files) {
    const cleanPath = pathMap.get(file.path) ?? cleanArxivPath(file.path)
    const content = typeof file.content === 'string'
      ? rewritePackagedReferences(file.content, pathMap)
      : file.content
    packageFiles.push({ path: cleanPath, content })
  }

  if (isTypst) {
    const entry = workspace.files.find((file) => file.path === workspace.entryPath)
    if (entry && typeof entry.content === 'string') {
      try {
        const converted = await convertWithPandoc(entry.content, 'latex', 'typst')
        packageFiles.push({ path: 'converted-main.tex', content: converted.buffer })
      } catch (err) {
        packageFiles.push({ path: 'converted-main-error.txt', content: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  packageFiles.push({ path: 'compiled-manuscript.pdf', content: pdf })
  packageFiles.push({
    path: 'arxiv-submission-checklist.md',
    content: buildArxivChecklist({
      projectTitle: project.title,
      entryPath: pathMap.get(workspace.entryPath) ?? workspace.entryPath,
      originalEntryPath: workspace.entryPath,
      isLatex,
      isTypst,
      metadata: input.metadata,
      renamedPaths: [...pathMap.entries()].filter(([from, to]) => from !== to),
    }),
  })

  const baseName = sanitizeFileName(project.title || 'arxiv-submission')
  if (input.archiveFormat === 'tar.gz') {
    return {
      fileName: `${baseName}-arxiv.tar.gz`,
      mimeType: 'application/gzip',
      buffer: gzipSync(buildTarArchive(packageFiles)),
    }
  }

  const zip = new JSZip()
  for (const file of packageFiles) {
    zip.file(file.path, file.content)
  }
  return {
    fileName: `${baseName}-arxiv.zip`,
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }),
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project'
}

function cleanArxivPath(filePath: string): string {
  return filePath
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_+\-.,=]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'file')
    .join('/')
}

function buildCleanPathMap(paths: string[]): Map<string, string> {
  const used = new Set<string>()
  const map = new Map<string, string>()
  for (const originalPath of paths) {
    const cleanPath = uniqueCleanPath(cleanArxivPath(originalPath), used)
    used.add(cleanPath)
    map.set(originalPath, cleanPath)
  }
  return map
}

function uniqueCleanPath(cleanPath: string, used: Set<string>): string {
  if (!used.has(cleanPath)) {
    return cleanPath
  }

  const parsed = path.posix.parse(cleanPath)
  let index = 2
  while (used.has(path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`))) {
    index += 1
  }
  return path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
}

function rewritePackagedReferences(content: string, pathMap: Map<string, string>): string {
  let next = content
  for (const [from, to] of pathMap.entries()) {
    if (from === to) continue
    next = next.split(from).join(to)
    next = next.split(path.posix.basename(from)).join(path.posix.basename(to))
  }
  return next
}

function buildArxivChecklist(input: {
  projectTitle: string
  entryPath: string
  originalEntryPath: string
  isLatex: boolean
  isTypst: boolean
  metadata: Record<string, unknown>
  renamedPaths: Array<[string, string]>
}): string {
  const metadata = input.metadata as Record<string, any>
  const lines = [
    '# arXiv Submission Checklist',
    '',
    `- Project: ${input.projectTitle}`,
    `- Entry file: ${input.entryPath}`,
    `- Original entry file: ${input.originalEntryPath}`,
    `- Package mode: ${input.isLatex ? 'LaTeX source' : input.isTypst ? 'Typst source with converted-main.tex helper' : 'PDF/source'}`,
    `- Generated PDF: compiled-manuscript.pdf`,
    '',
    '## Metadata',
    `- Title: ${metadata.title ?? ''}`,
    `- Authors: ${Array.isArray(metadata.authors) ? metadata.authors.join(', ') : metadata.authors ?? ''}`,
    `- Abstract: ${metadata.abstract ? 'provided' : ''}`,
    `- Categories: ${Array.isArray(metadata.categories) ? metadata.categories.join(', ') : metadata.categories ?? ''}`,
    `- DOI: ${metadata.doi ?? ''}`,
    `- Journal reference: ${metadata.journalRef ?? ''}`,
    `- Comments: ${metadata.comments ?? ''}`,
    `- License: ${metadata.license ?? ''}`,
    '',
    '## Manual Checks',
    '- Confirm title, abstract, authors, category, license, comments, DOI, and journal reference in arXiv.',
    '- Confirm compiled-manuscript.pdf matches the source package.',
    '- Confirm all figures and bibliography files are included.',
    '- Confirm filenames use only arXiv-safe characters.',
    '- For Typst projects, verify converted-main.tex before using it as TeX source; arXiv does not generally accept Typst source as TeX.',
    '',
    '## Renamed Files',
    ...(input.renamedPaths.length
      ? input.renamedPaths.map(([from, to]) => `- ${from} -> ${to}`)
      : ['- No filenames required cleaning.']),
    '',
  ]
  return `${lines.join('\n')}\n`
}

function buildTarArchive(files: Array<{ path: string; content: string | Buffer }>): Buffer {
  const chunks: Buffer[] = []
  for (const file of files) {
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8')
    chunks.push(buildTarHeader(file.path, content.length))
    chunks.push(content)
    const padding = (512 - (content.length % 512)) % 512
    if (padding) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function buildTarHeader(filePath: string, size: number): Buffer {
  if (Buffer.byteLength(filePath, 'utf8') > 99) {
    throw new Error(`Cannot build tar.gz package because "${filePath}" exceeds the classic tar path limit. Use ZIP for this project or shorten the path.`)
  }

  const header = Buffer.alloc(512)
  writeTarString(header, 0, 100, filePath)
  writeTarString(header, 100, 8, '0000644')
  writeTarString(header, 108, 8, '0000000')
  writeTarString(header, 116, 8, '0000000')
  writeTarString(header, 124, 12, size.toString(8).padStart(11, '0'))
  writeTarString(header, 136, 12, Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'))
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')
  const checksum = [...header].reduce((sum, value) => sum + value, 0)
  writeTarString(header, 148, 8, checksum.toString(8).padStart(6, '0'))
  header[154] = 0
  header[155] = 0x20
  return header
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value.slice(0, length - 1), offset, length, 'ascii')
}

function parseArxivAtom(xml: string): Array<{
  id: string
  title: string
  authors: string[]
  summary: string
  published: string | null
  updated: string | null
  categories: string[]
  doi: string | null
  journalRef: string | null
  pdfUrl: string | null
}> {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((entryMatch) => {
    const entry = entryMatch[1] ?? ''
    const idUrl = readXmlTag(entry, 'id') ?? ''
    return {
      id: idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//i, ''),
      title: normalizeXmlText(readXmlTag(entry, 'title') ?? ''),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((match) => normalizeXmlText(match[1] ?? '')).filter(Boolean),
      summary: normalizeXmlText(readXmlTag(entry, 'summary') ?? ''),
      published: readXmlTag(entry, 'published'),
      updated: readXmlTag(entry, 'updated'),
      categories: [...entry.matchAll(/<category\s+term="([^"]+)"/g)].map((match) => decodeXml(match[1] ?? '')).filter(Boolean),
      doi: readArxivExtension(entry, 'doi'),
      journalRef: readArxivExtension(entry, 'journal_ref'),
      pdfUrl: entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/)?.[1] ?? null,
    }
  })
}

function readXmlTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match?.[1] ? decodeXml(match[1]) : null
}

function readArxivExtension(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<arxiv:${tagName}[^>]*>([\\s\\S]*?)<\\/arxiv:${tagName}>`, 'i'))
  return match?.[1] ? normalizeXmlText(match[1]) : null
}

function normalizeXmlText(value: string): string {
  return decodeXml(value).replace(/\s+/g, ' ').trim()
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
