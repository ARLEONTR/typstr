import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { compileTypstProjectToPdf } from './compiler.js'
import type { ExportFormat, ProjectFormat } from '../types.js'

interface WorkspaceFileLike {
  path: string
  content: string | Buffer
  mimeType: string
}

interface ExportResult {
  buffer: Buffer
  mimeType: string
  extension: string
}

const FORMAT_MAP: Record<ExportFormat, { pandocTarget: string; mime: string; ext: string }> = {
  docx: {
    pandocTarget: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  latex: {
    pandocTarget: 'latex',
    mime: 'application/x-latex',
    ext: 'tex',
  },
  html: {
    pandocTarget: 'html',
    mime: 'text/html; charset=utf-8',
    ext: 'html',
  },
  pdf: {
    pandocTarget: 'pdf',
    mime: 'application/pdf',
    ext: 'pdf',
  },
}

const PANDOC_FORMAT_MAP: Record<ProjectFormat, string> = {
  typst: 'typst',
  latex: 'latex',
  gdoc: 'markdown',
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

export async function convertWithPandoc(source: string, format: ExportFormat, sourceFormat: 'typst' | 'latex' = 'typst'): Promise<ExportResult> {
  if (format === 'pdf') {
    if (sourceFormat === 'latex') {
      throw new Error('PDF export for LaTeX projects must use the LaTeX compiler flow.')
    }
    return compileTypstToPdf(source)
  }

  const { pandocTarget, mime, ext } = FORMAT_MAP[format]
  const converted = await convertDocumentBufferWithPandoc(source, sourceFormat, pandocTarget, pandocTarget === 'html')

  return {
    buffer: converted,
    mimeType: mime,
    extension: ext,
  }
}

export async function convertProjectFormatWithPandoc(
  source: string,
  sourceFormat: ProjectFormat,
  targetFormat: ProjectFormat,
): Promise<string> {
  return convertDocumentWithPandoc(source, PANDOC_FORMAT_MAP[sourceFormat], PANDOC_FORMAT_MAP[targetFormat], false)
}

export async function convertProjectSourceToHtmlWithPandoc(
  source: string,
  sourceFormat: ProjectFormat,
): Promise<string> {
  return convertDocumentWithPandoc(source, PANDOC_FORMAT_MAP[sourceFormat], 'html', true)
}

export async function convertLatexWorkspaceToHtmlWithPandoc(input: {
  entryPath: string
  files: WorkspaceFileLike[]
}): Promise<string> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'typstr-pandoc-html-'))

  try {
    writeWorkspaceFiles(tmpDir, input.files)
    const entryFile = resolveWorkspacePath(tmpDir, input.entryPath)
    const buffer = await runPandoc(
      [
        entryFile,
        '-f', 'latex',
        '-t', 'html',
        '-o', '-',
        '--standalone',
        '--citeproc',
        '--mathjax',
        '--resource-path', tmpDir,
      ],
      { cwd: tmpDir },
    )
    return buffer.toString('utf8')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function convertLatexWorkspaceToHtmlWithMake4ht(input: {
  entryPath: string
  files: WorkspaceFileLike[]
}): Promise<string> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'typstr-make4ht-'))
  const outputDir = path.join(tmpDir, 'out')

  try {
    mkdirSync(outputDir, { recursive: true })
    writeWorkspaceFiles(tmpDir, input.files)

    const entryFile = resolveWorkspacePath(tmpDir, input.entryPath)
    const entrySource = readFileSync(entryFile, 'utf8')
    const buildFilePath = path.join(tmpDir, `${path.posix.basename(input.entryPath).replace(/\.[^.]+$/, '')}.mk4`)
    writeFileSync(buildFilePath, buildMake4htBuildFile(entrySource), 'utf8')

    await runMake4ht([
      '-f', 'html5',
      '-d', outputDir,
      entryFile,
    ], { cwd: tmpDir })

    const htmlFilePath = path.join(outputDir, `${path.posix.basename(input.entryPath).replace(/\.[^.]+$/, '')}.html`)
    if (!existsSync(htmlFilePath)) {
      throw new Error(`make4ht did not produce an HTML file for ${input.entryPath}`)
    }

    const html = readFileSync(htmlFilePath, 'utf8')
    return inlineLocalHtmlAssets(html, outputDir, htmlFilePath)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function convertWorkspaceFilesToTypst<T extends WorkspaceFileLike>(files: T[]): Promise<T[]> {
  const sourceFileByPath = new Map(files.map((file) => [normalizeWorkspacePath(file.path), file] as const))
  const sourceDirectoryPaths = collectWorkspaceDirectoryPaths(files.map((file) => file.path))
  const convertedTypstPaths = new Map<string, string>()

  let convertedAny = false
  const convertedFiles = await Promise.all(files.map(async (file) => {
    if (!/\.(tex|ltx|latex)$/i.test(file.path) || typeof file.content !== 'string') {
      return file
    }

    convertedAny = true
    const convertedPath = resolveConvertedTypstPath(file.path, sourceDirectoryPaths)
    convertedTypstPaths.set(normalizeWorkspacePath(file.path), normalizeWorkspacePath(convertedPath))
    return {
      ...file,
      path: convertedPath,
      mimeType: 'text/plain',
      content: await convertProjectFormatWithPandoc(file.content, 'latex', 'typst'),
    }
  }))

  if (!convertedAny) {
    throw new Error('No LaTeX source files were found to convert to Typst.')
  }

  const availablePaths = new Set(convertedFiles.map((file) => normalizeWorkspacePath(file.path)))

  return convertedFiles.map((file) => {
    if (typeof file.content !== 'string' || !/\.typ$/i.test(file.path)) {
      return file
    }

    const sourcePath = file.path.replace(/\.typ$/i, '.tex')
    const sourceFile = sourceFileByPath.get(normalizeWorkspacePath(sourcePath))
    if (!sourceFile || typeof sourceFile.content !== 'string') {
      return file
    }

    return {
      ...file,
      content: postProcessConvertedTypstContent({
        convertedPath: file.path,
        convertedContent: file.content,
        sourcePath: sourceFile.path,
        sourceContent: sourceFile.content,
        availablePaths,
        convertedTypstPaths,
      }),
    }
  })
}

function postProcessConvertedTypstContent(input: {
  convertedPath: string
  convertedContent: string
  sourcePath: string
  sourceContent: string
  availablePaths: Set<string>
  convertedTypstPaths: Map<string, string>
}): string {
  let nextContent = input.convertedContent

  nextContent = normalizeTypstFileReferences(nextContent, input.convertedPath, input.availablePaths)
  nextContent = normalizeTypstTableLabels(nextContent)

  const bibliographyPaths = extractBibliographyPaths(input.sourcePath, input.sourceContent, input.availablePaths)
  if (bibliographyPaths.length > 0) {
    nextContent = ensureTypstBibliography(nextContent, bibliographyPaths[0])
  }

  nextContent = rewriteConvertedInputReferences(nextContent, input.sourcePath, input.convertedPath, input.sourceContent, input.convertedTypstPaths)
  nextContent = degradeMissingTableReferences(nextContent, input.sourceContent)
  return nextContent
}

function normalizeTypstTableLabels(content: string): string {
  return content.replace(/#block\[\s*\n(#figure\([\s\S]*?,\s*kind:\s*table\s*\)\s*)\n\s*\]\s*<(tab:[^>]+)>/g, '$1 <$2>')
}

function degradeMissingTableReferences(content: string, sourceContent: string): string {
  const sourceTableLabels = new Set(matchLatexCommandArguments(sourceContent, 'label').filter((label) => label.startsWith('tab:')))
  if (sourceTableLabels.size === 0) {
    return content
  }

  const convertedTableLabels = new Set([...content.matchAll(/<(tab:[^>]+)>/g)].map((match) => match[1]))
  let nextContent = content
  for (const label of sourceTableLabels) {
    if (convertedTableLabels.has(label)) {
      continue
    }

    nextContent = nextContent
      .replace(new RegExp(`Table~@${escapeRegExp(label)}`, 'g'), 'the table below')
      .replace(new RegExp(`table~@${escapeRegExp(label)}`, 'g'), 'the table below')
      .replace(new RegExp(`@${escapeRegExp(label)}`, 'g'), 'the table below')
  }

  return nextContent
}

function normalizeTypstFileReferences(content: string, sourcePath: string, availablePaths: Set<string>): string {
  let nextContent = content.replace(/#bibliography\(\s*"([^"]+)"\s*\)/g, (full, targetPath) => {
    const resolved = resolveWorkspaceReference({
      sourcePath,
      targetPath,
      availablePaths,
      preferredExtensions: ['.bib'],
    })
    return resolved ? `#bibliography("${resolved}")` : full
  })

  nextContent = nextContent.replace(/#include\s+"([^"]+)"/g, (full, targetPath) => {
    const resolved = resolveWorkspaceReference({
      sourcePath,
      targetPath,
      availablePaths,
      preferredExtensions: ['.typ'],
      fallbackMainFile: true,
    })
    return resolved ? `#include "${resolved}"` : full
  })

  nextContent = nextContent.replace(/#import\s+"([^"]+)"/g, (full, targetPath) => {
    const resolved = resolveWorkspaceReference({
      sourcePath,
      targetPath,
      availablePaths,
      preferredExtensions: ['.typ'],
      fallbackMainFile: true,
    })
    return resolved ? `#import "${resolved}"` : full
  })

  return nextContent
}

function rewriteConvertedInputReferences(
  content: string,
  sourcePath: string,
  convertedPath: string,
  sourceContent: string,
  convertedTypstPaths: Map<string, string>,
): string {
  const inputTargets = extractLatexInputPaths(sourceContent)
  if (inputTargets.length === 0) {
    return content
  }

  const sourceDir = path.posix.dirname(normalizeWorkspacePath(sourcePath))
  const convertedDir = path.posix.dirname(normalizeWorkspacePath(convertedPath))

  let nextContent = content
  for (const targetPath of inputTargets) {
    const absoluteTarget = normalizeWorkspacePath(path.posix.join(sourceDir === '.' ? '' : sourceDir, targetPath))
    const convertedTarget = convertedTypstPaths.get(absoluteTarget) ?? convertedTypstPaths.get(`${absoluteTarget}.tex`)
    if (!convertedTarget) {
      continue
    }

    const relativeTarget = path.posix.relative(convertedDir === '.' ? '' : convertedDir, convertedTarget) || path.posix.basename(convertedTarget)
    const normalizedRelativeTarget = relativeTarget.replace(/^\.\//, '')

    nextContent = nextContent
      .replace(new RegExp(`#include\\s+"${escapeRegExp(targetPath)}"`, 'g'), `#include "${normalizedRelativeTarget}"`)
      .replace(new RegExp(`#import\\s+"${escapeRegExp(targetPath)}"`, 'g'), `#import "${normalizedRelativeTarget}"`)
      .replace(new RegExp(`#bibliography\\(\\s*"${escapeRegExp(targetPath)}"\\s*\\)`, 'g'), `#bibliography("${normalizedRelativeTarget}")`)
  }

  return nextContent
}

function ensureTypstBibliography(content: string, bibliographyPath: string): string {
  if (/^#bibliography\(/m.test(content)) {
    return content
  }

  if (!/@[A-Za-z0-9:_-]+/.test(content)) {
    return content
  }

  const trimmed = content.trimEnd()
  return `${trimmed}\n\n#bibliography("${bibliographyPath}")\n`
}

function extractBibliographyPaths(sourcePath: string, sourceContent: string, availablePaths: Set<string>): string[] {
  const matches = [
    ...matchLatexCommandArguments(sourceContent, 'bibliography'),
    ...matchLatexCommandArguments(sourceContent, 'addbibresource'),
  ]

  const resolved = matches
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^[{]+|[}]+$/g, '').replace(/\.bib$/i, ''))
    .map((value) => resolveWorkspaceReference({
      sourcePath,
      targetPath: value,
      availablePaths,
      preferredExtensions: ['.bib'],
    }))
    .filter((value): value is string => Boolean(value))

  return [...new Set(resolved)]
}

function extractLatexInputPaths(sourceContent: string): string[] {
  return [
    ...matchLatexCommandArguments(sourceContent, 'input'),
    ...matchLatexCommandArguments(sourceContent, 'include'),
    ...matchLatexCommandArguments(sourceContent, 'subfile'),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
}

function matchLatexCommandArguments(source: string, command: string): string[] {
  const matches = [...source.matchAll(new RegExp(String.raw`\\${command}(?:\[[^\]]*\])?\{([^}]+)\}`, 'g'))]
  return matches.map((match) => match[1] ?? '').filter(Boolean)
}

function resolveWorkspaceReference(input: {
  sourcePath: string
  targetPath: string
  availablePaths: Set<string>
  preferredExtensions: string[]
  fallbackMainFile?: boolean
}): string | null {
  const sourceDir = path.posix.dirname(normalizeWorkspacePath(input.sourcePath))
  const normalizedTarget = normalizeWorkspacePath(path.posix.join(sourceDir === '.' ? '' : sourceDir, input.targetPath))
  const extension = path.posix.extname(normalizedTarget)
  const candidates = extension
    ? [normalizedTarget]
    : [
        ...input.preferredExtensions.map((preferredExtension) => `${normalizedTarget}${preferredExtension}`),
        ...(input.fallbackMainFile ? input.preferredExtensions.map((preferredExtension) => `${normalizedTarget}/main${preferredExtension}`) : []),
        normalizedTarget,
      ]

  const resolved = candidates.find((candidate) => input.availablePaths.has(candidate))
  if (!resolved) {
    return null
  }

  const relativePath = path.posix.relative(sourceDir === '.' ? '' : sourceDir, resolved)
  return relativePath && relativePath !== '' ? relativePath.replace(/^\.\//, '') : path.posix.basename(resolved)
}

function normalizeWorkspacePath(value: string): string {
  return path.posix.normalize(value).replace(/^\/+/, '')
}

function collectWorkspaceDirectoryPaths(filePaths: string[]): Set<string> {
  const directories = new Set<string>()
  for (const filePath of filePaths) {
    const normalized = normalizeWorkspacePath(filePath)
    const parts = normalized.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  return directories
}

function resolveConvertedTypstPath(sourcePath: string, sourceDirectoryPaths: Set<string>): string {
  const normalizedSourcePath = normalizeWorkspacePath(sourcePath)
  const baseWithoutExtension = normalizedSourcePath.replace(/\.(tex|ltx|latex)$/i, '')
  if (sourceDirectoryPaths.has(baseWithoutExtension)) {
    return `${baseWithoutExtension}/main.typ`
  }

  return normalizedSourcePath.replace(/\.(tex|ltx|latex)$/i, '.typ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function convertDocumentWithPandoc(
  source: string,
  sourceFormat: string,
  targetFormat: string,
  standalone = false,
): Promise<string> {
  const buffer = await convertDocumentBufferWithPandoc(source, sourceFormat, targetFormat, standalone)
  return buffer.toString('utf8')
}

async function convertDocumentBufferWithPandoc(
  source: string,
  sourceFormat: string,
  targetFormat: string,
  standalone = false,
): Promise<Buffer> {
  const args = ['-f', sourceFormat, '-t', targetFormat, '-o', '-']
  if (standalone) args.push('--standalone')

  return runPandoc(args, { source })
}

async function runPandoc(
  args: string[],
  options: {
    source?: string
    cwd?: string
    timeoutMs?: number
  } = {},
): Promise<Buffer> {
  const { source, cwd } = options
  const timeoutMs = options.timeoutMs ?? 60_000

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn('pandoc', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      cwd,
    })

    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`pandoc conversion timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Failed to start pandoc: ${err.message}. Is pandoc installed?`))
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(Buffer.concat(outChunks))
      } else {
        const errMsg = stripAnsi(Buffer.concat(errChunks).toString('utf8')).trim()
        reject(new Error(errMsg || `pandoc exited with code ${code}`))
      }
    })

    if (source !== undefined) {
      proc.stdin.write(source, 'utf8')
    }
    proc.stdin.end()
  })
}

async function runMake4ht(
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
  } = {},
): Promise<void> {
  const { cwd } = options
  const timeoutMs = options.timeoutMs ?? 60_000

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('make4ht', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      cwd,
    })

    const outputChunks: Buffer[] = []
    proc.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => outputChunks.push(chunk))

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`make4ht conversion timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Failed to start make4ht: ${err.message}. Is make4ht installed?`))
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        const errMsg = stripAnsi(Buffer.concat(outputChunks).toString('utf8')).trim()
        reject(new Error(errMsg || `make4ht exited with code ${code}`))
      }
    })
  })
}

function buildMake4htBuildFile(source: string): string {
  const usesBiblatex = /\\usepackage(?:\[[^\]]*\])?\{biblatex\}/i.test(source)
  const usesBiber = usesBiblatex && /\bbiber\b/i.test(source)
  const usesBibliography = /\\bibliography\s*\{/i.test(source) || /\\printbibliography\b/i.test(source)

  if (!usesBibliography) {
    return 'Make:autohtlatex()\n'
  }

  const bibliographyCommand = usesBiber ? 'Make:biber()' : 'Make:bibtex()'
  return `Make:autohtlatex()\n${bibliographyCommand}\nMake:autohtlatex()\n`
}

function inlineLocalHtmlAssets(html: string, outputDir: string, htmlFilePath: string): string {
  const htmlDir = path.dirname(htmlFilePath)

  const resolveLocalFile = (rawValue: string): string | null => {
    if (!rawValue || /^(?:[a-z]+:|#|\/\/)/i.test(rawValue)) {
      return null
    }

    const resolved = path.resolve(htmlDir, rawValue)
    if (resolved !== outputDir && !resolved.startsWith(outputDir + path.sep)) {
      return null
    }
    if (!existsSync(resolved)) {
      return null
    }
    return resolved
  }

  let nextHtml = html.replace(/<link\b([^>]*?)href=("([^"]*)"|'([^']*)')([^>]*)>/gi, (full, beforeHref, _quoted, dqValue, sqValue, afterHref) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const resolved = resolveLocalFile(rawValue)
    if (!resolved || path.extname(resolved).toLowerCase() !== '.css') {
      return full
    }

    return `<style data-inline-asset="${escapeHtmlAttribute(rawValue)}">${readFileSync(resolved, 'utf8')}</style>`
  })

  nextHtml = nextHtml.replace(/\b(src|href|data)=("([^"]*)"|'([^']*)')/gi, (full, attribute, quoted, dqValue, sqValue) => {
    const rawValue = (dqValue ?? sqValue ?? '').trim()
    const resolved = resolveLocalFile(rawValue)
    if (!resolved) {
      return full
    }

    const mimeType = mimeTypeForHtmlAsset(resolved)
    const content = readFileSync(resolved)
    const replacement = `data:${mimeType};base64,${content.toString('base64')}`
    return `${attribute}=${quoted[0]}${replacement}${quoted[0]}`
  })

  return nextHtml
}

function mimeTypeForHtmlAsset(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.ttf': return 'font/ttf'
    case '.otf': return 'font/otf'
    default: return 'application/octet-stream'
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function writeWorkspaceFiles(tmpDir: string, files: WorkspaceFileLike[]): void {
  for (const file of files) {
    const filePath = resolveWorkspacePath(tmpDir, file.path)
    mkdirSync(path.dirname(filePath), { recursive: true })
    if (typeof file.content === 'string') {
      writeFileSync(filePath, file.content, 'utf8')
    } else {
      writeFileSync(filePath, file.content)
    }
  }
}

function resolveWorkspacePath(tmpDir: string, relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const resolvedPath = path.join(tmpDir, normalizedPath)
  if (resolvedPath !== tmpDir && !resolvedPath.startsWith(tmpDir + path.sep)) {
    throw new Error(`Invalid workspace path: ${relativePath}`)
  }
  return resolvedPath
}

export async function compileTypstToPdf(source: string): Promise<ExportResult> {
  return compileTypstProjectPdf({
    entryPath: 'input.typ',
    files: [{ path: 'input.typ', content: source }],
  })
}

export async function compileTypstProjectPdf(input: {
  entryPath: string
  files: Array<{ path: string; content: string | Buffer }>
}): Promise<ExportResult> {
  const buffer = await compileTypstProjectToPdf(input)
  return {
    buffer,
    mimeType: 'application/pdf',
    extension: 'pdf',
  }
}
