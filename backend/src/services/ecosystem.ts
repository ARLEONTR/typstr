import path from 'node:path'
import type {
  BibliographyFileSummary,
  CitationRecord,
  CompileDiagnostic,
  EcosystemValidationIssue,
  ProseSuggestion,
  ProjectEcosystemSettings,
  ProjectFile,
  ProjectFontAsset,
  ProjectMetadataFile,
  ProjectWritingStats,
  ReferenceTarget,
  ReusableAsset,
  TypstPackageCatalogEntry,
} from '../types.js'

export const LIBRARY_FOLDER_NAME = '_typstr-library'
export const PROJECT_INTERNAL_FOLDER = '.typstr'
export const PROJECT_FONTS_FOLDER = `${PROJECT_INTERNAL_FOLDER}/fonts`

export const PROJECT_METADATA_FILE_DEFINITIONS: Array<{ path: string; description: string }> = [
  {
    path: 'typst.toml',
    description: 'Project-wide Typst configuration and package context.',
  },
  {
    path: `${PROJECT_INTERNAL_FOLDER}/project-metadata.json`,
    description: 'Structured project metadata for title, authors, and automation helpers.',
  },
]

export const TYPOGRAPHY_PACKAGE_CATALOG: TypstPackageCatalogEntry[] = [
  {
    packageId: '@preview/cetz',
    title: 'CeTZ',
    description: 'Vector diagrams, coordinate systems, and technical drawings.',
    latestVersion: '0.4.2',
    keywords: ['diagram', 'drawing', 'graphics'],
  },
  {
    packageId: '@preview/cetz-plot',
    title: 'CeTZ Plot',
    description: 'Data plotting and visualization using CeTZ.',
    latestVersion: '0.1.3',
    keywords: ['plot', 'chart', 'visualization'],
  },
  {
    packageId: '@preview/fletcher',
    title: 'Fletcher',
    description: 'Commutative diagrams and arrow-heavy mathematical figures.',
    latestVersion: '0.5.8',
    keywords: ['diagram', 'math', 'arrows'],
  },
  {
    packageId: '@preview/glossarium',
    title: 'Glossarium',
    description: 'Glossaries, acronym handling, and reference lists.',
    latestVersion: '0.5.4',
    keywords: ['glossary', 'acronym', 'references'],
  },
  {
    packageId: '@preview/physica',
    title: 'Physica',
    description: 'Physics notation helpers and scientific typesetting utilities.',
    latestVersion: '0.9.5',
    keywords: ['physics', 'science', 'notation'],
  },
  {
    packageId: '@preview/touying',
    title: 'Touying',
    description: 'Presentation and slide deck tooling for Typst.',
    latestVersion: '0.6.1',
    keywords: ['slides', 'presentation'],
  },
  {
    packageId: '@preview/tablex',
    title: 'Tablex',
    description: 'Advanced tables, layout helpers, and tabular styling.',
    latestVersion: '0.0.9',
    keywords: ['table', 'layout'],
  },
  {
    packageId: '@preview/codly',
    title: 'Codly',
    description: 'Source-code listings, annotations, and code presentation.',
    latestVersion: '1.3.0',
    keywords: ['code', 'listing', 'syntax'],
  },
]

const DEFAULT_PROJECT_ECOSYSTEM_SETTINGS: ProjectEcosystemSettings = {
  packagePins: [],
  writingSnippets: [
    {
      id: 'abstract-block',
      name: 'Abstract Block',
      description: 'Structured abstract section scaffold for papers and reports.',
      content: '= Abstract\nSummarize the goal, method, and outcome in 150-250 words.\n',
    },
    {
      id: 'figure-block',
      name: 'Figure Block',
      description: 'Figure scaffold with caption and label.',
      content: '#figure(\n  image("figures/plot.png", width: 100%),\n  caption: [Key result caption],\n) <fig:key-result>\n',
    },
    {
      id: 'equation-block',
      name: 'Equation Block',
      description: 'Display equation scaffold with a label.',
      content: '$ a^2 + b^2 = c^2 $ <eq:pythagoras>\n',
    },
  ],
  writingGoals: {
    targetWords: null,
    dailyWords: null,
    deadline: null,
  },
  aiSettings: {
    model: '', // Empty means use the most efficient discovered model
    systemInstructions: null,
  },
}

    const FONT_FILE_PATTERN = /\.(ttf|otf|ttc|woff|woff2)$/i
const PACKAGE_IMPORT_PATTERN = /#import\s+"(@[^"/:]+\/[^"]+?):([^"\s]+)"/g
const INCLUDE_PATTERN = /(?:^|[^\w-])#?include\s+"([^"]+)"/gm
const IMPORT_PATTERN = /(?:^|[^\w-])#?import\s+"([^"]+)"/gm
const IMAGE_PATTERN = /(?:^|[^\w-])#?image\(\s*"([^"]+)"/gm
const BIB_PATTERN = /(?:^|[^\w-])#?bibliography\(\s*"([^"]+)"/gm
const LABEL_PATTERN = /<([A-Za-z0-9:_-]+)>/g
const BIB_ENTRY_PATTERN = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\}\s*(?=@|$)/g
const COMMON_TYPO_FIXES: Record<string, string> = {
  accomodate: 'accommodate',
  definately: 'definitely',
  occured: 'occurred',
  recieve: 'receive',
  seperate: 'separate',
  teh: 'the',
  adn: 'and',
}

export function normalizeProjectEcosystemSettings(input: Partial<ProjectEcosystemSettings> | null | undefined): ProjectEcosystemSettings {
  const pins = Array.isArray(input?.packagePins)
    ? input.packagePins
    : []
  const snippets = input?.writingSnippets === undefined
    ? DEFAULT_PROJECT_ECOSYSTEM_SETTINGS.writingSnippets
    : Array.isArray(input.writingSnippets)
      ? input.writingSnippets
      : []
  const goals = input?.writingGoals ?? DEFAULT_PROJECT_ECOSYSTEM_SETTINGS.writingGoals
  const ai = input?.aiSettings ?? DEFAULT_PROJECT_ECOSYSTEM_SETTINGS.aiSettings

  const normalizedPins = pins
    .map((pin) => ({
      packageId: typeof pin?.packageId === 'string' ? pin.packageId.trim() : '',
      version: typeof pin?.version === 'string' ? pin.version.trim() : '',
    }))
    .filter((pin) => pin.packageId.startsWith('@') && pin.packageId.includes('/') && pin.version.length > 0)
    .sort((left, right) => left.packageId.localeCompare(right.packageId))

  const normalizedSnippets = snippets
    .map((snippet, index) => ({
      id: typeof snippet?.id === 'string' && snippet.id.trim()
        ? snippet.id.trim()
        : `snippet-${index + 1}`,
      name: typeof snippet?.name === 'string' ? snippet.name.trim() : '',
      description: typeof snippet?.description === 'string' ? snippet.description.trim() : '',
      content: typeof snippet?.content === 'string' ? snippet.content.replace(/\r\n/g, '\n') : '',
    }))
    .filter((snippet) => snippet.name.length > 0 && snippet.content.trim().length > 0)

  const dedupedSnippets = normalizedSnippets.filter((snippet, index, entries) => entries.findIndex((candidate) => candidate.id === snippet.id) === index)

  return {
    packagePins: dedupePackagePins(normalizedPins),
    writingSnippets: dedupedSnippets,
    writingGoals: {
      targetWords: normalizeNullableInteger(goals.targetWords),
      dailyWords: normalizeNullableInteger(goals.dailyWords),
      deadline: normalizeNullableDeadline(goals.deadline),
    },
    aiSettings: {
      model: typeof ai?.model === 'string' && ai.model.trim() ? ai.model.trim() : 'gemini-2.5-flash',
      systemInstructions: typeof ai?.systemInstructions === 'string' ? ai.systemInstructions : null,
    },
  }
}

export function buildBibliographyFileSummaries(files: ProjectFile[]): BibliographyFileSummary[] {
  return files
    .filter((file) => /\.bib$/i.test(file.path))
    .map((file) => ({
      fileId: file.id,
      path: file.path,
      entryCount: 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function buildCslFileSummaries(files: ProjectFile[]): Array<{ fileId: string; path: string }> {
  return files
    .filter((file) => /\.csl$/i.test(file.path))
    .map((file) => ({ fileId: file.id, path: file.path }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function collectCitationRecords(files: Array<{ path: string; content: string | Buffer; mimeType?: string }>): CitationRecord[] {
  const citations: CitationRecord[] = []

  for (const file of files) {
    if (typeof file.content !== 'string' || !/\.bib$/i.test(file.path)) {
      continue
    }

    for (const match of file.content.matchAll(BIB_ENTRY_PATTERN)) {
      const entryType = match[1]?.trim().toLowerCase() ?? 'entry'
      const key = match[2]?.trim() ?? ''
      const body = match[3] ?? ''
      if (!key) {
        continue
      }

      citations.push({
        key,
        entryType,
        title: readBibField(body, 'title') ?? key,
        authors: splitBibAuthors(readBibField(body, 'author')),
        year: readBibField(body, 'year'),
        filePath: file.path,
        line: lineNumberAt(file.content, match.index ?? 0),
        abstract: readBibField(body, 'abstract'),
        doi: readBibField(body, 'doi'),
        url: buildCitationUrl(body),
      })
    }
  }

  return citations.sort((left, right) => left.key.localeCompare(right.key))
}

export function collectDuplicateCitationIssues(citations: CitationRecord[]): EcosystemValidationIssue[] {
  const groups = new Map<string, CitationRecord[]>()

  for (const citation of citations) {
    const identity = citationIdentity(citation)
    if (!identity) {
      continue
    }

    groups.set(identity, [...(groups.get(identity) ?? []), citation])
  }

  const issues: EcosystemValidationIssue[] = []
  for (const duplicates of groups.values()) {
    const uniqueKeys = [...new Set(duplicates.map((citation) => citation.key))]
    if (uniqueKeys.length < 2) {
      continue
    }

    const first = duplicates[0]
    issues.push({
      code: 'duplicate-citation',
      level: 'warning',
      message: `Possible duplicate paper appears under multiple keys: ${uniqueKeys.map((key) => `@${key}`).join(', ')}.`,
      filePath: first.filePath,
      line: first.line,
      column: null,
    })
  }

  return issues.sort((left, right) => (left.filePath ?? '').localeCompare(right.filePath ?? '') || (left.line ?? 0) - (right.line ?? 0))
}

export function collectReferenceTargets(files: Array<{ path: string; content: string | Buffer; mimeType?: string }>): ReferenceTarget[] {
  const targets: ReferenceTarget[] = []

  for (const file of files) {
    if (typeof file.content !== 'string' || !isTextLikePath(file.path, file.mimeType)) {
      continue
    }

    const lines = file.content.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(LABEL_PATTERN)) {
        const label = match[1]?.trim()
        if (!label) {
          continue
        }

        const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 1)).join(' ')
        const kind = classifyReferenceTarget(line, context)
        const title = summarizeReferenceTarget(line, context, label)
        targets.push({
          label,
          kind,
          title,
          filePath: file.path,
          line: index + 1,
        })
      }
    })
  }

  return targets
    .filter((target, index, entries) => entries.findIndex((candidate) => candidate.label === target.label) === index)
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function buildProjectWritingStats(
  files: Array<{ path: string; content: string | Buffer; mimeType?: string }>,
  citations: CitationRecord[],
  references: ReferenceTarget[],
): ProjectWritingStats {
  const analyzableFiles = files.filter((file) => typeof file.content === 'string' && isWritingAnalysisPath(file.path, file.mimeType))
  const sections: ProjectWritingStats['sections'] = []
  let totalWords = 0
  let characterCount = 0

  for (const file of analyzableFiles) {
    const content = String(file.content)
    totalWords += countWords(content)
    characterCount += content.length
    sections.push(...collectSectionStats(file.path, content))
  }

  return {
    totalWords,
    characterCount,
    readingTimeMinutes: Math.max(1, Math.ceil(totalWords / 220)),
    sectionCount: sections.length,
    citationCount: citations.length,
    referenceCount: references.length,
    sections: sections.sort((left, right) => left.filePath === right.filePath ? left.line - right.line : left.filePath.localeCompare(right.filePath)),
  }
}

export function collectProseSuggestions(files: Array<{ path: string; content: string | Buffer; mimeType?: string }>): ProseSuggestion[] {
  const suggestions: ProseSuggestion[] = []

  for (const file of files) {
    if (typeof file.content !== 'string' || !isWritingAnalysisPath(file.path, file.mimeType)) {
      continue
    }

    const lines = file.content.split(/\r?\n/)
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        return
      }

      const repeatedWord = trimmed.match(/\b([A-Za-z][A-Za-z'-]*)\s+\1\b/i)
      if (repeatedWord) {
        suggestions.push({
          id: `${file.path}:${index + 1}:repeated-word`,
          kind: 'grammar',
          message: `Repeated word "${repeatedWord[1]}" detected.`,
          filePath: file.path,
          line: index + 1,
          excerpt: trimmed.slice(0, 160),
        })
      }

      if (/[A-Za-z]\s{2,}[A-Za-z]/.test(line)) {
        suggestions.push({
          id: `${file.path}:${index + 1}:double-space`,
          kind: 'style',
          message: 'Multiple consecutive spaces inside prose can indicate a copy-editing issue.',
          filePath: file.path,
          line: index + 1,
          excerpt: trimmed.slice(0, 160),
        })
      }

      if (countWords(trimmed) >= 35) {
        suggestions.push({
          id: `${file.path}:${index + 1}:long-line`,
          kind: 'style',
          message: 'This sentence is long enough to consider splitting for readability.',
          filePath: file.path,
          line: index + 1,
          excerpt: trimmed.slice(0, 160),
        })
      }

      for (const [typo, correction] of Object.entries(COMMON_TYPO_FIXES)) {
        if (new RegExp(`\\b${typo}\\b`, 'i').test(trimmed)) {
          suggestions.push({
            id: `${file.path}:${index + 1}:typo:${typo}`,
            kind: 'spelling',
            message: `Possible typo "${typo}". Consider "${correction}".`,
            filePath: file.path,
            line: index + 1,
            excerpt: trimmed.slice(0, 160),
          })
        }
      }
    })
  }

  return suggestions.filter((suggestion, index, entries) => entries.findIndex((candidate) => candidate.id === suggestion.id) === index)
}

export function listProjectFonts(files: ProjectFile[]): ProjectFontAsset[] {
  return files
    .filter((file) => FONT_FILE_PATTERN.test(file.name))
    .filter((file) => file.path === file.name || file.path.startsWith(`${PROJECT_FONTS_FOLDER}/`))
    .map((file) => ({
      fileId: file.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function buildProjectMetadataFiles(input: Partial<Record<string, string>>): ProjectMetadataFile[] {
  return PROJECT_METADATA_FILE_DEFINITIONS.map((definition) => ({
    path: definition.path,
    description: definition.description,
    content: input[definition.path] ?? '',
  }))
}

export function buildReusableAssets(entries: Array<{ id: string; name: string; path: string; mimeType: string }>): ReusableAsset[] {
  return entries
    .filter((entry) => entry.mimeType !== 'application/vnd.google-apps.folder')
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      mimeType: entry.mimeType,
    }))
}

export function buildPackageSuggestions(settings: ProjectEcosystemSettings): Array<{ label: string; detail: string }> {
  const pinned = settings.packagePins.map((pin) => ({
    label: `${pin.packageId}:${pin.version}`,
    detail: 'Pinned in this project',
  }))

  const catalog = TYPOGRAPHY_PACKAGE_CATALOG.map((entry) => ({
    label: `${entry.packageId}:${entry.latestVersion}`,
    detail: entry.description,
  }))

  const seen = new Set<string>()
  return [...pinned, ...catalog].filter((entry) => {
    if (seen.has(entry.label)) {
      return false
    }

    seen.add(entry.label)
    return true
  })
}

export function validateProjectWorkspace(input: {
  files: Array<{ path: string; content: string | Buffer; mimeType?: string }>
  settings: ProjectEcosystemSettings
  metadataFiles?: Partial<Record<string, string>>
}): EcosystemValidationIssue[] {
  const fileSet = new Set(input.files.map((file) => normalizePath(file.path)))
  const issues: EcosystemValidationIssue[] = []
  const pins = new Map(input.settings.packagePins.map((pin) => [pin.packageId, pin.version] as const))
  const metadataFiles = input.metadataFiles ?? Object.fromEntries(
    input.files
      .filter((file) => typeof file.content === 'string')
      .filter((file) => PROJECT_METADATA_FILE_DEFINITIONS.some((definition) => definition.path === file.path))
      .map((file) => [file.path, typeof file.content === 'string' ? file.content : ''] as const),
  )

  for (const file of input.files) {
    if (typeof file.content !== 'string' || !isTextLikePath(file.path, file.mimeType)) {
      continue
    }

    for (const reference of collectReferenceIssues(file.path, file.content, fileSet)) {
      issues.push(reference)
    }

    for (const packageIssue of collectPackageIssues(file.path, file.content, pins)) {
      issues.push(packageIssue)
    }
  }

  const metadataJson = metadataFiles[`${PROJECT_INTERNAL_FOLDER}/project-metadata.json`]?.trim()
  if (metadataJson) {
    try {
      JSON.parse(metadataJson)
    } catch {
      issues.push({
        code: 'invalid-project-metadata',
        level: 'error',
        message: 'The project metadata JSON file is not valid JSON.',
        filePath: `${PROJECT_INTERNAL_FOLDER}/project-metadata.json`,
        line: 1,
        column: 1,
      })
    }
  }

  return dedupeValidationIssues(issues)
}

export function ecosystemIssuesToCompileDiagnostics(issues: EcosystemValidationIssue[]): CompileDiagnostic[] {
  return issues.map((issue) => ({
    level: issue.level,
    message: issue.message,
    filePath: issue.filePath,
    line: issue.line,
    column: issue.column,
    raw: `${issue.code}: ${issue.message}`,
  }))
}

export function fontPathsFromWorkspace(files: Array<{ path: string }>): string[] {
  const directories = new Set<string>()

  for (const file of files) {
    if (!FONT_FILE_PATTERN.test(file.path)) {
      continue
    }

    const directory = path.dirname(file.path)
    directories.add(directory === '.' ? '' : directory)
  }

  return [...directories]
}

function collectReferenceIssues(
  sourcePath: string,
  content: string,
  files: Set<string>,
): EcosystemValidationIssue[] {
  const issues: EcosystemValidationIssue[] = []

  for (const pattern of [
    { regex: INCLUDE_PATTERN, code: 'broken-include', label: 'include' },
    { regex: IMPORT_PATTERN, code: 'missing-import', label: 'import' },
    { regex: IMAGE_PATTERN, code: 'missing-asset', label: 'asset' },
    { regex: BIB_PATTERN, code: 'missing-bibliography', label: 'bibliography' },
  ]) {
    for (const match of content.matchAll(pattern.regex)) {
      const rawTarget = match[1]?.trim()
      if (!rawTarget || rawTarget.startsWith('@')) {
        continue
      }

      const resolved = resolveProjectPath(sourcePath, rawTarget)
      if (resolved && files.has(resolved)) {
        continue
      }

      const location = offsetToLineColumn(content, match.index ?? 0)
      issues.push({
        code: pattern.code,
        level: 'error',
        message: `The ${pattern.label} target "${rawTarget}" could not be found in this project.`,
        filePath: sourcePath,
        line: location.line,
        column: location.column,
      })
    }
  }

  return issues
}

function collectPackageIssues(
  sourcePath: string,
  content: string,
  pins: Map<string, string>,
): EcosystemValidationIssue[] {
  const issues: EcosystemValidationIssue[] = []

  for (const match of content.matchAll(PACKAGE_IMPORT_PATTERN)) {
    const packageId = match[1]?.trim()
    const version = match[2]?.trim()
    if (!packageId || !version) {
      continue
    }

    const location = offsetToLineColumn(content, match.index ?? 0)
    const pinnedVersion = pins.get(packageId)
    if (!pinnedVersion) {
      issues.push({
        code: 'unpinned-package',
        level: 'warning',
        message: `${packageId} is imported at ${version} but is not pinned in the project ecosystem settings.`,
        filePath: sourcePath,
        line: location.line,
        column: location.column,
      })
      continue
    }

    if (pinnedVersion !== version) {
      issues.push({
        code: 'package-version-mismatch',
        level: 'warning',
        message: `${packageId} is pinned to ${pinnedVersion}, but this file imports ${version}.`,
        filePath: sourcePath,
        line: location.line,
        column: location.column,
      })
    }
  }

  return issues
}

function resolveProjectPath(sourcePath: string, targetPath: string): string | null {
  const baseDir = path.posix.dirname(normalizePath(sourcePath))
  const joined = targetPath.startsWith('/')
    ? targetPath.slice(1)
    : path.posix.join(baseDir === '.' ? '' : baseDir, targetPath)

  const normalized = normalizePath(joined)
  if (!normalized || normalized.startsWith('../') || normalized === '..') {
    return null
  }

  return normalized
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath).replace(/^\/+/, '')
}

function isTextLikePath(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) {
    return true
  }

  return /\.(typ|txt|md|json|yaml|yml|toml|xml|bib|csv|svg)$/i.test(filePath)
}

function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, content.length))
  const segment = content.slice(0, safeOffset)
  const lines = segment.split(/\r?\n/)
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : ''
  return {
    line: lines.length,
    column: lastLine.length + 1,
  }
}

function dedupePackagePins(pins: ProjectEcosystemSettings['packagePins']): ProjectEcosystemSettings['packagePins'] {
  const seen = new Set<string>()
  const deduped: ProjectEcosystemSettings['packagePins'] = []

  for (const pin of pins) {
    if (seen.has(pin.packageId)) {
      continue
    }

    seen.add(pin.packageId)
    deduped.push(pin)
  }

  return deduped
}

function dedupeValidationIssues(issues: EcosystemValidationIssue[]): EcosystemValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.filePath ?? ''}:${issue.line ?? ''}:${issue.column ?? ''}:${issue.message}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function normalizeNullableInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

function normalizeNullableDeadline(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function readBibField(body: string, fieldName: string): string | null {
  const match = body.match(new RegExp(`${fieldName}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)")`, 'i'))
  const value = match?.[1] ?? match?.[2] ?? ''
  return value.trim() ? value.replace(/\s+/g, ' ').trim() : null
}

function splitBibAuthors(value: string | null): string[] {
  if (!value) {
    return []
  }

  return value.split(/\s+and\s+/i).map((entry) => entry.trim()).filter(Boolean)
}

function buildCitationUrl(body: string): string | null {
  const directUrl = readBibField(body, 'url')
  if (directUrl) {
    return directUrl
  }

  const doi = readBibField(body, 'doi')
  if (doi) {
    return `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '').trim()}`
  }

  const arxiv = readBibField(body, 'arxiv') ?? readBibField(body, 'eprint')
  if (arxiv) {
    return `https://arxiv.org/abs/${arxiv.trim()}`
  }

  return null
}

function citationIdentity(citation: CitationRecord): string | null {
  const doi = citation.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase().trim()
  if (doi) {
    return `doi:${doi}`
  }

  const arxiv = citation.url?.match(/arxiv\.org\/abs\/([A-Za-z0-9.\-]+)/i)?.[1]?.toLowerCase()
  if (arxiv) {
    return `arxiv:${arxiv}`
  }

  const normalizedTitle = citation.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (normalizedTitle.length < 12) {
    return null
  }

  return `title:${normalizedTitle}:${citation.year ?? 'nd'}`
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1
    }
  }
  return line
}

function classifyReferenceTarget(line: string, context: string): ReferenceTarget['kind'] {
  if (/^\s*=+\s+/.test(line)) {
    return 'heading'
  }

  const lowered = context.toLowerCase()
  if (lowered.includes('#figure(')) {
    return 'figure'
  }

  if (lowered.includes('#table(')) {
    return 'table'
  }

  if (lowered.includes('#equation(') || line.includes('$')) {
    return 'equation'
  }

  return 'generic'
}

function summarizeReferenceTarget(line: string, context: string, fallbackLabel: string): string {
  const heading = line.replace(LABEL_PATTERN, '').replace(/^\s*=+\s+/, '').trim()
  if (heading) {
    return heading
  }

  const captionMatch = context.match(/caption\s*:\s*\[([^\]]+)\]/i)
  if (captionMatch?.[1]?.trim()) {
    return captionMatch[1].trim()
  }

  return fallbackLabel
}

function isWritingAnalysisPath(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) {
    return true
  }

  return /\.(typ|md|txt)$/i.test(filePath)
}

function countWords(content: string): number {
  return content.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length ?? 0
}

function collectSectionStats(filePath: string, content: string): ProjectWritingStats['sections'] {
  const lines = content.split(/\r?\n/)
  const headings = lines
    .map((line, index) => {
      const match = line.match(/^\s*=+\s+(.+?)\s*$/)
      if (!match) {
        return null
      }

      return {
        line: index + 1,
        title: match[1].replace(LABEL_PATTERN, '').trim(),
      }
    })
    .filter((heading): heading is { line: number; title: string } => Boolean(heading))

  return headings.map((heading, index) => {
    const start = heading.line - 1
    const end = (headings[index + 1]?.line ?? (lines.length + 1)) - 1
    const segment = lines.slice(start, end).join('\n')
    const words = countWords(segment)
    return {
      title: heading.title || 'Untitled Section',
      filePath,
      line: heading.line,
      words,
      readingTimeMinutes: Math.max(1, Math.ceil(words / 220)),
    }
  })
}
