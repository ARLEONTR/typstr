import { useState, useMemo, useCallback, useRef } from 'react'
import { apiClient } from '../../api/client'
import axios from 'axios'
import type { CitationRecord, ProjectEcosystemState, ProjectRole } from '../../types'
import {
  Check,
  Database,
  ExternalLink,
  FilePlus,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from '../../icons'
import styles from './BibliographyPanel.module.css'

type BibliographySectionKey = 'files' | 'helper' | 'import' | 'citations' | 'search'

interface SearchResult {
  id: string
  source: 'arxiv' | 'dblp'
  title: string
  authors: string[]
  year: string | null
  abstract: string | null
  doi: string | null
  url: string | null
  venue: string | null
  bibEntry: string | null
}

interface SearchResponse {
  data?: SearchResult[]
  cached?: boolean
  stale?: boolean
  upstreamUnavailable?: boolean
  error?: string
}

type BibEntryType =
  | 'article' | 'book' | 'booklet' | 'conference' | 'inbook' | 'incollection'
  | 'inproceedings' | 'manual' | 'mastersthesis' | 'misc' | 'phdthesis'
  | 'proceedings' | 'techreport' | 'unpublished' | 'online'

type ManualBibEntryDraft = {
  entryType: BibEntryType
  key: string
  title: string
  authors: string
  year: string
  venue: string
  doi: string
  url: string
  abstract: string
}

type BibliographyImportFormat = 'bibtex' | 'ris' | 'nbib' | 'unknown'
type CitationPreviewStyle = 'apa' | 'ieee' | 'chicago'

interface Props {
  projectId: string
  role: ProjectRole
  ecosystem: ProjectEcosystemState | null
  isLoading: boolean
  error: string | null
  onInsertAtCursor: (text: string) => void
  onAddBibEntry: (entry: string) => Promise<void>
  onFormatBibliography: () => Promise<void>
  onSortBibliography: () => Promise<void>
  onUpsertProjectTextFile: (path: string, source: string, options?: { open?: boolean }) => Promise<void>
  onJumpToReference: (filePath: string, line?: number) => void
  onRefresh: () => Promise<void>
  onGenerateAI?: (prompt: string, context?: string, projectId?: string) => Promise<string>
}

function citationTargetUrl(citation: { url: string | null }): string | null {
  return citation.url
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results
    .filter((result) => {
      const key = (result.doi || result.url || result.id || result.title).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => {
      const leftYear = Number.parseInt(left.year ?? '0', 10) || 0
      const rightYear = Number.parseInt(right.year ?? '0', 10) || 0
      return rightYear - leftYear
    })
}

function formatCitationPreview(citation: CitationRecord, style: CitationPreviewStyle): string {
  const authorText = formatPreviewAuthors(citation.authors, style)
  const title = citation.title || citation.key
  const year = citation.year ?? 'n.d.'

  if (style === 'ieee') {
    return `${authorText || 'Unknown author'}, "${title}," ${year}.`
  }

  if (style === 'chicago') {
    return `${authorText || 'Unknown author'}. "${title}." ${year}.`
  }

  return `${authorText || 'Unknown author'} (${year}). ${title}.`
}

function formatPreviewAuthors(authors: string[], style: CitationPreviewStyle): string {
  if (authors.length === 0) {
    return ''
  }

  const normalized = authors.map((author) => author.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (style === 'ieee') {
    return normalized.length > 2 ? `${compactAuthorName(normalized[0])} et al.` : normalized.map(compactAuthorName).join(' and ')
  }

  if (normalized.length === 1) {
    return normalized[0]
  }

  if (normalized.length === 2) {
    return `${normalized[0]} and ${normalized[1]}`
  }

  return `${normalized[0]} et al.`
}

function compactAuthorName(author: string): string {
  if (author.includes(',')) {
    const [last, first = ''] = author.split(',').map((part) => part.trim())
    const initials = first.split(/\s+/).filter(Boolean).map((part) => `${part[0]}.`).join(' ')
    return [initials, last].filter(Boolean).join(' ')
  }

  return author
}

function buildManualBibEntry(draft: ManualBibEntryDraft): string {
  const lines = [`@${draft.entryType}{${draft.key.trim()},`]
  lines.push(`  title = {${draft.title.trim()}},`)
  if (draft.authors.trim()) {
    lines.push(`  author = {${draft.authors.trim()}},`)
  }
  if (draft.year.trim()) {
    lines.push(`  year = {${draft.year.trim()}},`)
  }
  if (draft.venue.trim()) {
    const venueField = (draft.entryType === 'book' || draft.entryType === 'booklet' || draft.entryType === 'manual' || draft.entryType === 'mastersthesis' || draft.entryType === 'phdthesis' || draft.entryType === 'techreport' || draft.entryType === 'unpublished') ? 'publisher'
      : (draft.entryType === 'inproceedings' || draft.entryType === 'conference' || draft.entryType === 'proceedings') ? 'booktitle'
      : (draft.entryType === 'incollection' || draft.entryType === 'inbook') ? 'booktitle'
      : (draft.entryType === 'online') ? 'url'
      : 'journal'
    lines.push(`  ${venueField} = {${draft.venue.trim()}},`)
  }
  if (draft.doi.trim()) {
    lines.push(`  doi = {${draft.doi.trim()}},`)
  }
  if (draft.url.trim()) {
    lines.push(`  url = {${draft.url.trim()}},`)
  }
  if (draft.abstract.trim()) {
    lines.push(`  abstract = {${draft.abstract.trim()}},`)
  }
  lines.push('}')
  return lines.join('\n')
}

function detectBibliographyFormat(input: string, fileName?: string): BibliographyImportFormat {
  const normalized = input.trim()
  const lowerName = fileName?.toLowerCase() ?? ''
  if (lowerName.endsWith('.bib') || normalized.startsWith('@')) {
    return 'bibtex'
  }
  if (lowerName.endsWith('.ris') || /^TY\s{0,2}-/m.test(normalized)) {
    return 'ris'
  }
  if (lowerName.endsWith('.nbib') || /^PMID-\s|^TI\s{1,2}-\s|^FAU\s{1,2}-\s/m.test(normalized)) {
    return 'nbib'
  }
  return 'unknown'
}

function slugifyToken(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return normalized || fallback
}

function buildGeneratedBibKey(author: string | undefined, year: string | undefined, title: string | undefined): string {
  const lastName = slugifyToken(author?.split(/\s+/).pop() ?? '', 'source')
  const safeYear = (year?.match(/\d{4}/)?.[0]) ?? 'nd'
  const firstWord = slugifyToken(title?.split(/\s+/)[0] ?? '', 'entry')
  return `${lastName}${safeYear}${firstWord}`
}

function escapeBibTexValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

function buildBibTeXFromFields(input: {
  entryType: string
  key?: string
  title?: string
  authors?: string[]
  year?: string
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  publisher?: string
}): string {
  const key = input.key?.trim() || buildGeneratedBibKey(input.authors?.[0], input.year, input.title)
  const lines = [`@${input.entryType}{${key},`]
  if (input.title?.trim()) lines.push(`  title = {${escapeBibTexValue(input.title)}},`)
  if (input.authors?.length) lines.push(`  author = {${input.authors.map(escapeBibTexValue).join(' and ')}},`)
  if (input.year?.trim()) lines.push(`  year = {${escapeBibTexValue(input.year)}},`)
  if (input.venue?.trim()) {
    const fieldName = (input.entryType === 'book' || input.entryType === 'booklet' || input.entryType === 'manual') ? 'publisher'
      : (input.entryType === 'inproceedings' || input.entryType === 'conference' || input.entryType === 'proceedings' || input.entryType === 'incollection' || input.entryType === 'inbook') ? 'booktitle'
      : 'journal'
    lines.push(`  ${fieldName} = {${escapeBibTexValue(input.venue)}},`)
  }
  if (input.publisher?.trim() && input.entryType !== 'book') lines.push(`  publisher = {${escapeBibTexValue(input.publisher)}},`)
  if (input.doi?.trim()) lines.push(`  doi = {${escapeBibTexValue(input.doi)}},`)
  if (input.url?.trim()) lines.push(`  url = {${escapeBibTexValue(input.url)}},`)
  if (input.abstract?.trim()) lines.push(`  abstract = {${escapeBibTexValue(input.abstract)}},`)
  lines.push('}')
  return lines.join('\n')
}

function parseRisRecords(input: string): string[] {
  const records = input
    .split(/\nER\s{0,2}-.*(?:\n|$)/)
    .map((record) => record.trim())
    .filter(Boolean)

  return records.map((record) => {
    const fields = new Map<string, string[]>()
    for (const line of record.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9]{2})\s{0,2}-\s?(.*)$/)
      if (!match) continue
      const tag = match[1]
      const value = match[2].trim()
      fields.set(tag, [...(fields.get(tag) ?? []), value])
    }

    const type = (fields.get('TY')?.[0] ?? '').toUpperCase()
    const entryType = type === 'JOUR' ? 'article' : type === 'BOOK' ? 'book' : type === 'CPAPER' || type === 'CONF' ? 'inproceedings' : 'misc'
    return buildBibTeXFromFields({
      entryType,
      key: fields.get('ID')?.[0],
      title: fields.get('TI')?.[0] ?? fields.get('T1')?.[0],
      authors: fields.get('AU') ?? fields.get('A1') ?? [],
      year: fields.get('PY')?.[0] ?? fields.get('Y1')?.[0],
      venue: fields.get('JO')?.[0] ?? fields.get('JF')?.[0] ?? fields.get('T2')?.[0],
      doi: fields.get('DO')?.[0],
      url: fields.get('UR')?.[0],
      abstract: fields.get('AB')?.[0],
      publisher: fields.get('PB')?.[0],
    })
  })
}

function parseNbibRecords(input: string): string[] {
  const normalized = input.replace(/\r\n/g, '\n')
  const records = normalized
    .split(/\n(?=PMID-\s)/)
    .map((record) => record.trim())
    .filter(Boolean)

  return records.map((record) => {
    const fields = new Map<string, string[]>()
    let currentTag: string | null = null

    for (const line of record.split('\n')) {
      const fieldMatch = line.match(/^([A-Z]{2,4})\s*-\s?(.*)$/)
      if (fieldMatch) {
        currentTag = fieldMatch[1]
        fields.set(currentTag, [...(fields.get(currentTag) ?? []), fieldMatch[2].trim()])
        continue
      }

      if (currentTag && /^\s{6,}\S/.test(line)) {
        const current = fields.get(currentTag) ?? []
        current[current.length - 1] = `${current[current.length - 1]} ${line.trim()}`
        fields.set(currentTag, current)
      }
    }

    return buildBibTeXFromFields({
      entryType: 'article',
      key: fields.get('PMID')?.[0],
      title: fields.get('TI')?.[0] ?? fields.get('BTI')?.[0],
      authors: fields.get('FAU') ?? fields.get('AU') ?? [],
      year: fields.get('DP')?.[0],
      venue: fields.get('JT')?.[0] ?? fields.get('TA')?.[0],
      doi: fields.get('LID')?.find((value) => /\[doi\]/i.test(value))?.replace(/\s*\[doi\]\s*$/i, ''),
      url: fields.get('AID')?.find((value) => /^https?:/i.test(value)),
      abstract: fields.get('AB')?.[0],
    })
  })
}

function convertBibliographyImportToBibTeX(input: string, fileName?: string): { entries: string[]; format: BibliographyImportFormat } {
  const format = detectBibliographyFormat(input, fileName)
  if (format === 'bibtex') {
    return { format, entries: [input.trim()].filter(Boolean) }
  }
  if (format === 'ris') {
    return { format, entries: parseRisRecords(input) }
  }
  if (format === 'nbib') {
    return { format, entries: parseNbibRecords(input) }
  }
  return { format, entries: [] }
}

export default function BibliographyPanel({
  projectId,
  role,
  ecosystem,
  isLoading,
  error,
  onInsertAtCursor,
  onAddBibEntry,
  onFormatBibliography,
  onSortBibliography,
  onUpsertProjectTextFile,
  onJumpToReference,
  onRefresh,
  onGenerateAI,
}: Props) {
  const canEdit = role !== 'viewer'
  const [citationQuery, setCitationQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSource, setSearchSource] = useState<'all' | 'arxiv' | 'dblp'>('all')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null)
  const [importIdentifier, setImportIdentifier] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [citationPreviewStyle, setCitationPreviewStyle] = useState<CitationPreviewStyle>('apa')
  const [bulkImportValue, setBulkImportValue] = useState('')
  const [bulkImportStatus, setBulkImportStatus] = useState<string | null>(null)
  const [isBulkImporting, setIsBulkImporting] = useState(false)
  const [isValidatingAI, setIsValidatingAI] = useState(false)
  const [validationResults, setValidationResults] = useState<Record<string, { status: 'ok' | 'error' | 'warning', message: string }>>({})
  const [collapsedSections, setCollapsedSections] = useState<Record<BibliographySectionKey, boolean>>({
    files: false,
    helper: true,
    import: true,
    citations: true,
    search: true,
  })
  const [helperError, setHelperError] = useState<string | null>(null)
  const [maintenanceStatus, setMaintenanceStatus] = useState<string | null>(null)
  const [isFormattingBibliography, setIsFormattingBibliography] = useState(false)
  const [isSortingBibliography, setIsSortingBibliography] = useState(false)
  const [isCreatingManualEntry, setIsCreatingManualEntry] = useState(false)
  const [manualEntry, setManualEntry] = useState<ManualBibEntryDraft>({
    entryType: 'article' as BibEntryType,
    key: '',
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    url: '',
    abstract: '',
  })
  const [addedKeys, setAddedKeys] = useState(new Set<string>())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const bibliographyImportInputRef = useRef<HTMLInputElement>(null)

  const bibFiles = ecosystem?.bibliographyFiles ?? []
  const cslFiles = ecosystem?.cslFiles ?? []
  const totalCitations = ecosystem?.citations.length ?? 0
  const duplicateCitationIssues = useMemo(
    () => ecosystem?.validationIssues.filter((issue) => issue.code === 'duplicate-citation') ?? [],
    [ecosystem?.validationIssues],
  )
  const toggleSection = useCallback((section: BibliographySectionKey) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }))
  }, [])

  const filteredCitations = useMemo(() => {
    const q = citationQuery.trim().toLowerCase()
    if (!q) return ecosystem?.citations ?? []
    return (ecosystem?.citations ?? []).filter((c) =>
      [c.key, c.title, c.filePath ?? '', c.year ?? '', c.authors.join(' ')]
        .some((v) => v.toLowerCase().includes(q))
    )
  }, [citationQuery, ecosystem?.citations])

  const handleCreateBibFile = useCallback(async () => {
    await onUpsertProjectTextFile('references.bib', '% Bibliography\n% Add your references below\n\n', { open: true })
  }, [onUpsertProjectTextFile])

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setIsSearching(true)
    setSearchError(null)
    setSearchResults([])
    setExpandedAbstract(null)
    try {
      const endpoints = searchSource === 'all'
        ? [
            ['arXiv', 'arxiv-search'] as const,
            ['DBLP', 'dblp-search'] as const,
          ]
        : [[searchSource === 'arxiv' ? 'arXiv' : 'DBLP', searchSource === 'arxiv' ? 'arxiv-search' : 'dblp-search'] as const]

      const responses = await Promise.allSettled(endpoints.map(([, endpoint]) =>
        apiClient.get<SearchResponse>(`/api/projects/${projectId}/ecosystem/${endpoint}`, { params: { q } }),
      ))
      const results = responses.flatMap((result) => result.status === 'fulfilled' ? (result.value.data.data ?? []) : [])
      const deduped = dedupeSearchResults(results)
      const upstreamWarnings = responses.flatMap((result, index) => {
        const source = endpoints[index]?.[0] ?? 'Search'
        if (result.status === 'rejected') return [`${source} unavailable.`]
        if (result.value.data.upstreamUnavailable) return [`${source} unavailable${result.value.data.stale ? '; showing cached results.' : '.'}`]
        return []
      })

      setSearchResults(deduped)
      setSearchError(upstreamWarnings.length ? upstreamWarnings.join(' ') : null)
      if (deduped.length === 0 && upstreamWarnings.length === endpoints.length) {
        setSearchError(`${upstreamWarnings.join(' ')} Try again later or switch sources.`)
      }
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : err instanceof Error ? err.message : 'Search failed'
      setSearchError(message)
    } finally {
      setIsSearching(false)
    }
  }, [projectId, searchQuery, searchSource])

  const handleAddSearchResult = useCallback(async (result: SearchResult) => {
    if (!result.bibEntry) return
    const keyMatch = result.bibEntry.match(/@\w+\{([^,\s]+)/)
    const key = keyMatch?.[1] ?? ''
    try {
      await onAddBibEntry(result.bibEntry)
      if (key) setAddedKeys((prev) => new Set([...prev, key]))
    } catch { /* ignored */ }
  }, [onAddBibEntry])

  const handleImportIdentifier = useCallback(async () => {
    const identifier = importIdentifier.trim()
    if (!identifier) {
      return
    }

    setIsImporting(true)
    setImportError(null)
    try {
      const response = await apiClient.post<{ entry: string }>(`/api/projects/${projectId}/ecosystem/bib-import`, {
        identifier,
      })
      await onAddBibEntry(response.data.entry)
      setImportIdentifier('')
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : err instanceof Error
          ? err.message
          : 'Import failed'
      setImportError(message)
    } finally {
      setIsImporting(false)
    }
  }, [importIdentifier, onAddBibEntry, projectId])

  const runBulkImport = useCallback(async (input: string, fileName?: string) => {
    const { entries, format } = convertBibliographyImportToBibTeX(input, fileName)
    if (!entries.length) {
      setBulkImportStatus(format === 'unknown'
        ? 'Could not detect a supported bibliography format. Try BibTeX, RIS, or NBIB.'
        : `No importable records found in the ${format.toUpperCase()} content.`)
      return
    }

    setIsBulkImporting(true)
    setBulkImportStatus(null)
    try {
      await onAddBibEntry(entries.join('\n\n'))
      setBulkImportValue('')
      setBulkImportStatus(`Imported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${format.toUpperCase()}.`)
    } catch (err) {
      setBulkImportStatus(err instanceof Error ? err.message : 'Failed to import bibliography content.')
    } finally {
      setIsBulkImporting(false)
    }
  }, [onAddBibEntry])

  const handleAutoCheckDOIs = useCallback(async () => {
    if (!ecosystem || ecosystem.citations.length === 0 || !onGenerateAI) {
      return
    }

    setIsValidatingAI(true)
    setValidationResults({})
    try {
      const citations = ecosystem.citations
      const newResults: Record<string, { status: 'ok' | 'error' | 'warning', message: string }> = {}

      for (const citation of citations) {
        if (!citation.doi) {
          newResults[citation.key] = { status: 'warning', message: 'Missing DOI identifier.' }
          setValidationResults({ ...newResults })
          continue
        }

        try {
          const response = await apiClient.post<{ entry: string }>(`/api/projects/${projectId}/ecosystem/bib-import`, {
            identifier: citation.doi,
          })
          const officialEntry = response.data.entry
          
          const prompt = `
          Compare the following Project Citation with the Official BibTeX data fetched from its DOI.
          Identify any significant discrepancies in Title, Authors, Year, or Abstract.
          
          Project Citation:
          Key: ${citation.key}
          Title: ${citation.title}
          Abstract: ${citation.abstract?.slice(0, 500)}...
          
          Official BibTeX:
          ${officialEntry}
          
          If they match, say "MATCH". If there are differences, briefly list them.
          Return ONLY the result (MATCH or the list of differences).
          `
          
          const comparison = await onGenerateAI(prompt, `Validating ${citation.key}`, projectId)
          
          if (comparison.trim().toUpperCase().includes('MATCH')) {
            newResults[citation.key] = { status: 'ok', message: 'DOI verified and data matches.' }
          } else {
            newResults[citation.key] = { status: 'error', message: comparison }
          }
        } catch (err) {
          newResults[citation.key] = { status: 'error', message: 'DOI could not be resolved or found.' }
        }
        setValidationResults({ ...newResults })
      }
    } catch (err: any) {
      alert(err.message || 'Validation failed.')
    } finally {
      setIsValidatingAI(false)
    }
  }, [ecosystem, onGenerateAI, projectId])

  const handleBulkImport = useCallback(async () => {
    const input = bulkImportValue.trim()
    if (!input) {
      setBulkImportStatus('Paste BibTeX, RIS, or NBIB content to import it.')
      return
    }

    await runBulkImport(input)
  }, [bulkImportValue, runBulkImport])

  const handleBulkImportFile = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) {
      return
    }

    const text = await file.text()
    setBulkImportValue(text)
    await runBulkImport(text, file.name)
  }, [runBulkImport])

  const handleManualEntryChange = useCallback((field: keyof ManualBibEntryDraft, value: string) => {
    setManualEntry((current) => ({ ...current, [field]: value }))
  }, [])

  const handleCreateManualEntry = useCallback(async () => {
    if (!manualEntry.key.trim() || !manualEntry.title.trim()) {
      setHelperError('Entry key and title are required.')
      return
    }

    setIsCreatingManualEntry(true)
    setHelperError(null)
    try {
      await onAddBibEntry(buildManualBibEntry(manualEntry))
      setManualEntry({
        entryType: manualEntry.entryType,
        key: '',
        title: '',
        authors: '',
        year: '',
        venue: '',
        doi: '',
        url: '',
        abstract: '',
      })
    } catch (err) {
      setHelperError(err instanceof Error ? err.message : 'Failed to create BibTeX entry.')
    } finally {
      setIsCreatingManualEntry(false)
    }
  }, [manualEntry, onAddBibEntry])

  const handleFormatBibliography = useCallback(async () => {
    setIsFormattingBibliography(true)
    setMaintenanceStatus(null)
    try {
      await onFormatBibliography()
      setMaintenanceStatus('Formatted bibliography file.')
    } catch (err) {
      setMaintenanceStatus(err instanceof Error ? err.message : 'Failed to format bibliography file.')
    } finally {
      setIsFormattingBibliography(false)
    }
  }, [onFormatBibliography])

  const handleSortBibliography = useCallback(async () => {
    setIsSortingBibliography(true)
    setMaintenanceStatus(null)
    try {
      await onSortBibliography()
      setMaintenanceStatus('Sorted bibliography file by key.')
    } catch (err) {
      setMaintenanceStatus(err instanceof Error ? err.message : 'Failed to sort bibliography file.')
    } finally {
      setIsSortingBibliography(false)
    }
  }, [onSortBibliography])

  const isKeyInBib = useCallback((key: string) => {
    return ecosystem?.citations.some((c) => c.key.toLowerCase() === key.toLowerCase()) ?? false
  }, [ecosystem?.citations])

  if (isLoading && !ecosystem) {
    return <div className={styles.loading}>Loading bibliography…</div>
  }

  return (
    <div className={styles.panel}>
      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {duplicateCitationIssues.length > 0 ? (
        <div className={styles.warningBanner}>
          <strong>Duplicate citation warning</strong>
          {duplicateCitationIssues.slice(0, 3).map((issue) => (
            <button
              key={`${issue.filePath ?? 'project'}:${issue.line ?? 0}:${issue.message}`}
              className={styles.warningLink}
              type="button"
              onClick={() => issue.filePath ? onJumpToReference(issue.filePath, issue.line ?? undefined) : undefined}
            >
              {issue.message}
            </button>
          ))}
          {duplicateCitationIssues.length > 3 ? <span>+{duplicateCitationIssues.length - 3} more</span> : null}
        </div>
      ) : null}

      {/* ── Bibliography & CSL files ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <button className={styles.sectionToggle} onClick={() => toggleSection('files')} type="button">
            <span className={styles.sectionTitle}>Files</span>
            <span className={styles.sectionToggleIcon}>{collapsedSections.files ? '▸' : '▾'}</span>
          </button>
          <div className={styles.headerActions}>
            {canEdit ? (
              <button className={styles.iconBtn} title="Create references.bib" aria-label="Create references.bib" onClick={() => void handleCreateBibFile()}>
                <Plus size={15} aria-hidden />
              </button>
            ) : null}
            <button className={styles.iconBtn} title="Refresh" aria-label="Refresh bibliography" onClick={() => void onRefresh()}>
              <RefreshCw size={15} aria-hidden />
            </button>
          </div>
        </div>

        {!collapsedSections.files && (bibFiles.length === 0 && cslFiles.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>No bibliography files yet</span>
            {canEdit ? (
              <button className={styles.createBtn} onClick={() => void handleCreateBibFile()} title="Create references.bib" aria-label="Create references.bib">
                <FilePlus size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <div className={styles.fileList}>
            {bibFiles.map((bib) => (
              <div key={bib.fileId} className={styles.fileCard}>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{bib.path.split('/').pop()}</span>
                  <span className={styles.fileMeta}>{bib.entryCount} {bib.entryCount === 1 ? 'entry' : 'entries'}</span>
                </div>
                <button className={styles.ghostBtn} onClick={() => onJumpToReference(bib.path)} title="Open bibliography file" aria-label={`Open ${bib.path}`}>
                  <FileText size={15} aria-hidden />
                </button>
              </div>
            ))}
            {cslFiles.map((csl) => (
              <div key={csl.fileId} className={styles.fileCard}>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{csl.path.split('/').pop()}</span>
                  <span className={styles.fileMeta}>CSL style</span>
                </div>
                <button className={styles.ghostBtn} onClick={() => onJumpToReference(csl.path)} title="Open CSL file" aria-label={`Open ${csl.path}`}>
                  <FileText size={15} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Citation list ── */}
      {totalCitations > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <button className={styles.sectionToggle} onClick={() => toggleSection('citations')} type="button">
              <span className={styles.sectionTitle}>Citations ({totalCitations})</span>
              <span className={styles.sectionToggleIcon}>{collapsedSections.citations ? '▸' : '▾'}</span>
            </button>
            {!collapsedSections.citations && canEdit && onGenerateAI && (
              <button
                className={styles.iconBtn}
                onClick={handleAutoCheckDOIs}
                disabled={isValidatingAI}
                title="Use Gemini to verify DOIs and abstracts"
                aria-label="Use Gemini to verify DOIs and abstracts"
              >
                <Sparkles size={15} aria-hidden />
              </button>
            )}
          </div>
          {!collapsedSections.citations ? (
            <>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Filter by key, title, author…"
            value={citationQuery}
            onChange={(e) => setCitationQuery(e.target.value)}
          />
          <div className={styles.previewStyleRow}>
            <span>Citation preview</span>
            <select
              className={styles.previewStyleSelect}
              value={citationPreviewStyle}
              onChange={(event) => setCitationPreviewStyle(event.target.value as CitationPreviewStyle)}
              aria-label="Citation preview style"
            >
              <option value="apa">APA-like author-year</option>
              <option value="ieee">IEEE-like numeric</option>
              <option value="chicago">Chicago-like notes</option>
            </select>
          </div>
          <div className={styles.citationList}>
            {filteredCitations.slice(0, 50).map((citation, i) => (
              <div key={`${citation.key}:${i}`} className={styles.citationCard}>
                <button
                  type="button"
                  className={[styles.citationPreviewButton, !citationTargetUrl(citation) ? styles.citationPreviewButtonDisabled : ''].filter(Boolean).join(' ')}
                  onClick={() => {
                    const targetUrl = citationTargetUrl(citation)
                    if (targetUrl) {
                      window.open(targetUrl, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  disabled={!citationTargetUrl(citation)}
                  aria-label={citationTargetUrl(citation) ? `Open paper for citation ${citation.key}` : `No external paper link for citation ${citation.key}`}
                >
                  <div className={styles.citationTop}>
                    <span className={styles.citationKey}>@{citation.key}</span>
                    {citation.year ? <span className={styles.citationYear}>{citation.year}</span> : null}
                  </div>
                  <p className={styles.citationTitle}>{citation.title || '(no title)'}</p>
                  {citation.authors.length > 0 ? (
                    <p className={styles.citationAuthors}>
                      {citation.authors.slice(0, 3).join(', ')}{citation.authors.length > 3 ? ' et al.' : ''}
                    </p>
                  ) : null}
                  <div className={styles.citationTooltip} role="tooltip">
                    <strong>{citation.title || citation.key}</strong>
                    {citation.authors.length > 0 ? <span>{citation.authors.join(', ')}</span> : null}
                    <p>{citation.abstract?.trim() || 'No abstract available in the indexed bibliography entry.'}</p>
                  </div>
                </button>
                <p className={styles.citationStylePreview}>{formatCitationPreview(citation, citationPreviewStyle)}</p>

                {validationResults[citation.key] && (
                  <div 
                    style={{ 
                      fontSize: '11px', 
                      margin: '4px 10px', 
                      padding: '6px 8px', 
                      borderRadius: '6px', 
                      background: validationResults[citation.key].status === 'ok' ? 'var(--success-bg)' : validationResults[citation.key].status === 'warning' ? 'var(--warning-bg)' : 'var(--danger-bg)',
                      color: validationResults[citation.key].status === 'ok' ? 'var(--success)' : validationResults[citation.key].status === 'warning' ? 'var(--warning)' : 'var(--danger)',
                      borderLeft: `3px solid ${validationResults[citation.key].status === 'ok' ? 'var(--success)' : validationResults[citation.key].status === 'warning' ? 'var(--warning)' : 'var(--danger)'}`
                    }}
                  >
                    {validationResults[citation.key].message}
                  </div>
                )}

                <div className={styles.citationActions}>
                  <button
                    className={styles.insertBtn}
                    onClick={() => onInsertAtCursor(`@${citation.key}`)}
                    title={`Insert @${citation.key}`}
                    aria-label={`Insert @${citation.key}`}
                  >
                    <span className={styles.iconBtnText}>@</span>
                  </button>
                  {citationTargetUrl(citation) ? (
                    <button
                      className={styles.ghostBtn}
                      onClick={() => window.open(citationTargetUrl(citation)!, '_blank', 'noopener,noreferrer')}
                      title="Open paper"
                      aria-label={`Open paper for ${citation.key}`}
                    >
                        <ExternalLink size={15} aria-hidden />
                      </button>
                  ) : null}
                  {citation.filePath ? (
                    <button className={styles.ghostBtn} onClick={() => onJumpToReference(citation.filePath!)} title="Go to file" aria-label={`Go to ${citation.filePath}`}>
                      <FileText size={15} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {filteredCitations.length === 0 && citationQuery ? (
              <span className={styles.emptyText}>No citations match "{citationQuery}"</span>
            ) : null}
          </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Paper search ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <button className={styles.sectionToggle} onClick={() => toggleSection('search')} type="button">
            <span className={styles.sectionTitle}>Search Papers</span>
            <span className={styles.sectionToggleIcon}>{collapsedSections.search ? '▸' : '▾'}</span>
          </button>
          {!collapsedSections.search ? (
            <div className={styles.scholarHeaderMeta}>
              <span className={styles.poweredBy}>arXiv / DBLP</span>
            </div>
          ) : null}
        </div>
        {!collapsedSections.search ? (
          <>
            <div className={styles.scholarSearchRow}>
              <select className={styles.helperSelect} value={searchSource} onChange={(event) => setSearchSource(event.target.value as 'all' | 'arxiv' | 'dblp')}>
                <option value="all">All</option>
                <option value="arxiv">arXiv</option>
                <option value="dblp">DBLP</option>
              </select>
              <input
                ref={searchInputRef}
                className={styles.searchInput}
                type="search"
                placeholder="Paper title, author, keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
              />
              <button
                className={styles.searchBtn}
                onClick={() => void handleSearch()}
                disabled={isSearching || !searchQuery.trim()}
                title={isSearching ? 'Searching papers' : 'Search papers'}
                aria-label={isSearching ? 'Searching papers' : 'Search papers'}
              >
                <Search size={15} aria-hidden />
              </button>
            </div>

            {searchError ? <p className={styles.errorText}>{searchError}</p> : null}

            <div className={styles.importRow}>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Paste DOI, doi.org URL, or arXiv URL/ID"
                value={importIdentifier}
                onChange={(e) => setImportIdentifier(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleImportIdentifier() }}
              />
              <button
                className={styles.searchBtn}
                onClick={() => void handleImportIdentifier()}
                disabled={isImporting || !importIdentifier.trim() || !canEdit}
                type="button"
                title={isImporting ? 'Importing to bibliography' : 'Import to bibliography'}
                aria-label={isImporting ? 'Importing to bibliography' : 'Import to bibliography'}
              >
                <Database size={15} aria-hidden />
              </button>
            </div>
            {importError ? <p className={styles.errorText}>{importError}</p> : null}

            {!isSearching && searchResults.length === 0 && searchQuery && !searchError ? (
              <span className={styles.emptyText}>No results found</span>
            ) : null}

            {searchResults.length > 0 ? (
              <div className={styles.scholarResults}>
                {searchResults.map((paper, index) => {
                  const key = paper.bibEntry?.match(/@\w+\{([^,\s]+)/)?.[1] ?? paper.id
                  const resultKey = [paper.source, paper.id || key || paper.title || 'result', index].join(':')
                  const alreadyAdded = addedKeys.has(key)
                  const alreadyInBib = isKeyInBib(key)
                  return (
                    <div key={resultKey} className={styles.scholarCard}>
                      <p className={styles.scholarTitle}>{paper.title}</p>
                      <p className={styles.scholarAuthors}>
                        {paper.authors.slice(0, 3).join(', ')}
                        {paper.authors.length > 3 ? ' et al.' : ''}
                        {paper.year ? ` · ${paper.year}` : ''}
                        {paper.venue ? ` · ${paper.venue}` : ''}
                      </p>
                      {paper.abstract ? (
                        <button className={styles.ghostBtn} onClick={() => setExpandedAbstract((current) => current === paper.id ? null : paper.id)} type="button" title={expandedAbstract === paper.id ? 'Hide abstract' : 'Show abstract'} aria-label={expandedAbstract === paper.id ? 'Hide abstract' : 'Show abstract'}>
                          <FileText size={15} aria-hidden />
                        </button>
                      ) : null}
                      {expandedAbstract === paper.id && paper.abstract ? (
                        <p className={styles.scholarMeta}>{paper.abstract}</p>
                      ) : null}
                      <div className={styles.scholarActions}>
                        {paper.url ? (
                          <a className={styles.ghostBtn} href={paper.url} target="_blank" rel="noreferrer" title="Open paper" aria-label="Open paper">
                            <ExternalLink size={15} aria-hidden />
                          </a>
                        ) : null}
                        {canEdit && paper.bibEntry ? (
                          <button
                            className={alreadyAdded || alreadyInBib ? styles.addedBtn : styles.addBtn}
                            onClick={() => void handleAddSearchResult(paper)}
                            disabled={alreadyAdded || alreadyInBib}
                            title={alreadyAdded ? 'Already added' : alreadyInBib ? 'Already in bibliography' : 'Add to bibliography'}
                            aria-label={alreadyAdded ? 'Already added' : alreadyInBib ? 'Already in bibliography' : 'Add to bibliography'}
                          >
                            {alreadyAdded || alreadyInBib ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {canEdit ? (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <button className={styles.sectionToggle} onClick={() => toggleSection('import')} type="button">
              <span className={styles.sectionTitle}>Import Bibliography</span>
              <span className={styles.sectionToggleIcon}>{collapsedSections.import ? '▸' : '▾'}</span>
            </button>
          </div>
          {!collapsedSections.import ? (
            <>
              <p className={styles.importHint}>Import common formats like `BibTeX`, `RIS`, and `NBIB` by pasting the content or selecting a file.</p>
              <div className={styles.helperActions}>
                <button className={styles.searchBtn} onClick={() => bibliographyImportInputRef.current?.click()} disabled={isBulkImporting} type="button" title="Choose bibliography file" aria-label="Choose bibliography file">
                  <Upload size={15} aria-hidden />
                </button>
                <button className={styles.ghostBtn} onClick={() => void handleBulkImport()} disabled={isBulkImporting || !bulkImportValue.trim()} type="button" title={isBulkImporting ? 'Importing pasted content' : 'Import pasted content'} aria-label={isBulkImporting ? 'Importing pasted content' : 'Import pasted content'}>
                  <Database size={15} aria-hidden />
                </button>
              </div>
              <input
                ref={bibliographyImportInputRef}
                className={styles.hiddenInput}
                type="file"
                accept=".bib,.ris,.nbib,.txt"
                onChange={(event) => {
                  void handleBulkImportFile(event.target.files)
                  event.currentTarget.value = ''
                }}
              />
              <textarea
                className={styles.helperTextarea}
                rows={8}
                value={bulkImportValue}
                onChange={(event) => setBulkImportValue(event.target.value)}
                placeholder="@article{...}\n\nTY  - JOUR\n...\n\nPMID- ..."
              />
              {bulkImportStatus ? <p className={styles.importStatus}>{bulkImportStatus}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <button className={styles.sectionToggle} onClick={() => toggleSection('helper')} type="button">
              <span className={styles.sectionTitle}>Bibliography Helper</span>
              <span className={styles.sectionToggleIcon}>{collapsedSections.helper ? '▸' : '▾'}</span>
            </button>
          </div>
          {!collapsedSections.helper ? (
            <>
              <div className={styles.helperGrid}>
                <label className={styles.helperField}>
                  <span>Type</span>
                  <select
                    className={styles.helperInput}
                    value={manualEntry.entryType}
                    onChange={(e) => handleManualEntryChange('entryType', e.target.value)}
                  >
                    <option value="article">article — Journal article</option>
                    <option value="book">book — Book with publisher</option>
                    <option value="booklet">booklet — Printed work, no publisher</option>
                    <option value="conference">conference — Conference paper (= inproceedings)</option>
                    <option value="inbook">inbook — Part of a book (chapter/pages)</option>
                    <option value="incollection">incollection — Part of a book with own title</option>
                    <option value="inproceedings">inproceedings — Conference proceedings paper</option>
                    <option value="manual">manual — Technical documentation</option>
                    <option value="mastersthesis">mastersthesis — Master's thesis</option>
                    <option value="misc">misc — Miscellaneous / fallback</option>
                    <option value="online">online — Website / online resource</option>
                    <option value="phdthesis">phdthesis — PhD dissertation</option>
                    <option value="proceedings">proceedings — Full conference proceedings</option>
                    <option value="techreport">techreport — Technical report</option>
                    <option value="unpublished">unpublished — Unpublished work</option>
                  </select>
                </label>
                <label className={styles.helperField}>
                  <span>Key</span>
                  <input className={styles.helperInput} value={manualEntry.key} onChange={(e) => handleManualEntryChange('key', e.target.value)} placeholder="doe2025paper" />
                </label>
                <label className={styles.helperField}>
                  <span>Year</span>
                  <input className={styles.helperInput} value={manualEntry.year} onChange={(e) => handleManualEntryChange('year', e.target.value)} placeholder="2025" />
                </label>
                <label className={[styles.helperField, styles.helperFieldWide].join(' ')}>
                  <span>Title</span>
                  <input className={styles.helperInput} value={manualEntry.title} onChange={(e) => handleManualEntryChange('title', e.target.value)} placeholder="Paper title" />
                </label>
                <label className={[styles.helperField, styles.helperFieldWide].join(' ')}>
                  <span>Authors</span>
                  <input className={styles.helperInput} value={manualEntry.authors} onChange={(e) => handleManualEntryChange('authors', e.target.value)} placeholder="Jane Doe and John Roe" />
                </label>
                <label className={[styles.helperField, styles.helperFieldWide].join(' ')}>
                  <span>Journal / Publisher / Booktitle</span>
                  <input className={styles.helperInput} value={manualEntry.venue} onChange={(e) => handleManualEntryChange('venue', e.target.value)} placeholder="Venue or publisher" />
                </label>
                <label className={styles.helperField}>
                  <span>DOI</span>
                  <input className={styles.helperInput} value={manualEntry.doi} onChange={(e) => handleManualEntryChange('doi', e.target.value)} placeholder="10.xxxx/..." />
                </label>
                <label className={styles.helperField}>
                  <span>URL</span>
                  <input className={styles.helperInput} value={manualEntry.url} onChange={(e) => handleManualEntryChange('url', e.target.value)} placeholder="https://..." />
                </label>
                <label className={[styles.helperField, styles.helperFieldWide].join(' ')}>
                  <span>Abstract</span>
                  <textarea className={styles.helperTextarea} rows={4} value={manualEntry.abstract} onChange={(e) => handleManualEntryChange('abstract', e.target.value)} placeholder="Optional abstract" />
                </label>
              </div>
              <div className={styles.helperActions}>
                <button className={styles.searchBtn} onClick={() => void handleCreateManualEntry()} disabled={isCreatingManualEntry || !manualEntry.key.trim() || !manualEntry.title.trim()} type="button" title={isCreatingManualEntry ? 'Adding to bibliography' : 'Add to bibliography'} aria-label={isCreatingManualEntry ? 'Adding to bibliography' : 'Add to bibliography'}>
                  <Plus size={15} aria-hidden />
                </button>
                <button className={styles.ghostBtn} onClick={() => onInsertAtCursor(buildManualBibEntry(manualEntry))} disabled={!manualEntry.key.trim() || !manualEntry.title.trim()} type="button" title="Insert draft" aria-label="Insert draft">
                  <FileText size={15} aria-hidden />
                </button>
                <button className={styles.ghostBtn} onClick={() => void handleFormatBibliography()} disabled={isFormattingBibliography || bibFiles.length === 0} type="button" title={isFormattingBibliography ? 'Formatting bibliography' : 'Format bibliography'} aria-label={isFormattingBibliography ? 'Formatting bibliography' : 'Format bibliography'}>
                  <Check size={15} aria-hidden />
                </button>
                <button className={styles.ghostBtn} onClick={() => void handleSortBibliography()} disabled={isSortingBibliography || bibFiles.length === 0} type="button" title={isSortingBibliography ? 'Sorting bibliography' : 'Sort bibliography'} aria-label={isSortingBibliography ? 'Sorting bibliography' : 'Sort bibliography'}>
                  <RefreshCw size={15} aria-hidden />
                </button>
              </div>
              {helperError ? <p className={styles.errorText}>{helperError}</p> : null}
              {maintenanceStatus ? <p className={styles.importStatus}>{maintenanceStatus}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
