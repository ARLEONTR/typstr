import { useState, useCallback, useRef } from 'react'
import { apiClient } from '../../api/client'
import axios from 'axios'
import styles from './BibliographyPanel.module.css'

interface ScholarAuthor {
  name: string
}

interface ScholarPaper {
  paperId: string
  title: string
  authors: ScholarAuthor[]
  year: number | null
  venue: string | null
  journal: { name: string } | null
  externalIds: { DOI?: string; ArXiv?: string } | null
  citationCount?: number
}

interface Props {
  projectId: string
  canEdit: boolean
  citationKeys: Set<string>
  onAddBibEntry: (entry: string) => Promise<void>
  onInsertAtCursor: (text: string) => void
}

function buildBibKey(paper: ScholarPaper): string {
  const lastName = (paper.authors[0]?.name ?? '').split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'
  const year = paper.year ?? 'nd'
  const firstWord = paper.title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? 'untitled'
  return `${lastName}${year}${firstWord}`
}

function buildBibEntry(paper: ScholarPaper): string {
  const key = buildBibKey(paper)
  const entryType = paper.journal?.name ? 'article' : 'misc'
  const venue = paper.journal?.name ?? paper.venue ?? ''
  const doi = paper.externalIds?.DOI
  const lines: string[] = [`@${entryType}{${key},`]
  lines.push(`  title     = {${paper.title}},`)
  if (paper.authors.length > 0) lines.push(`  author    = {${paper.authors.map((a) => a.name).join(' and ')}},`)
  if (paper.year) lines.push(`  year      = {${paper.year}},`)
  if (venue) lines.push(`  journal   = {${venue}},`)
  if (doi) lines.push(`  doi       = {${doi}},`)
  lines.push('}')
  return lines.join('\n')
}

export default function ScholarPanel({ projectId, canEdit, citationKeys, onAddBibEntry, onInsertAtCursor }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScholarPaper[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addedKeys, setAddedKeys] = useState(new Set<string>())
  const [addingKey, setAddingKey] = useState<string | null>(null)

  const [doiQuery, setDoiQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const res = await apiClient.get<{ data?: ScholarPaper[] }>(`/api/projects/${projectId}/ecosystem/scholar-search`, { params: { q } })
      setResults(res.data.data ?? [])
    } catch (err) {
      setSearchError(axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [projectId, query])

  const handleAddPaper = useCallback(async (paper: ScholarPaper) => {
    const key = buildBibKey(paper)
    setAddingKey(key)
    try {
      await onAddBibEntry(buildBibEntry(paper))
      setAddedKeys((prev) => new Set([...prev, key]))
    } finally {
      setAddingKey(null)
    }
  }, [onAddBibEntry])

  const handleImportDoi = useCallback(async () => {
    const identifier = doiQuery.trim()
    if (!identifier) return
    setImporting(true)
    setImportError(null)
    setImportSuccess(null)
    try {
      const res = await apiClient.post<{ entry: string }>(`/api/projects/${projectId}/ecosystem/bib-import`, { identifier })
      await onAddBibEntry(res.data.entry)
      setImportSuccess(`Imported entry from DOI.`)
      setDoiQuery('')
    } catch (err) {
      setImportError(axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [doiQuery, onAddBibEntry, projectId])

  const handleOpenGoogleScholar = useCallback(() => {
    const q = query.trim()
    if (!q) { inputRef.current?.focus(); return }
    window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer')
  }, [query])

  const isKeyInBib = (key: string) => citationKeys.has(key.toLowerCase())

  return (
    <div className={styles.panel}>
      {/* Search row */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Semantic Scholar</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className={styles.poweredBy}>Powered by Semantic Scholar</span>
            <button className={styles.ghostBtn} onClick={handleOpenGoogleScholar} type="button" title="Open Google Scholar">
              Google Scholar ↗
            </button>
          </div>
        </div>

        <div className={styles.scholarSearchRow}>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="search"
            placeholder="Paper title, author, keyword…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            autoFocus
          />
          <button
            className={styles.searchBtn}
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            type="button"
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>

        {searchError ? <p className={styles.errorText}>{searchError}</p> : null}

        {!searching && results.length === 0 && query && !searchError ? (
          <span className={styles.emptyText}>No results found</span>
        ) : null}

        {results.length > 0 ? (
          <div className={styles.scholarResults}>
            {results.map((paper) => {
              const key = buildBibKey(paper)
              const alreadyAdded = addedKeys.has(key)
              const alreadyInBib = isKeyInBib(key)
              const isAdding = addingKey === key
              const doi = paper.externalIds?.DOI
              const arxiv = paper.externalIds?.ArXiv
              const venue = paper.journal?.name ?? paper.venue ?? ''
              return (
                <div key={paper.paperId} className={styles.scholarCard}>
                  <p className={styles.scholarTitle}>{paper.title}</p>
                  <p className={styles.scholarAuthors}>
                    {paper.authors.slice(0, 3).map((a) => a.name).join(', ')}
                    {paper.authors.length > 3 ? ' et al.' : ''}
                    {paper.year ? ` · ${paper.year}` : ''}
                    {venue ? ` · ${venue}` : ''}
                  </p>
                  {paper.citationCount != null ? (
                    <p className={styles.scholarMeta}>{paper.citationCount.toLocaleString()} citations</p>
                  ) : null}
                  <div className={styles.scholarActions}>
                    {doi ? (
                      <a className={styles.ghostBtn} href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">DOI ↗</a>
                    ) : arxiv ? (
                      <a className={styles.ghostBtn} href={`https://arxiv.org/abs/${arxiv}`} target="_blank" rel="noreferrer">arXiv ↗</a>
                    ) : null}
                    <button
                      className={styles.ghostBtn}
                      onClick={() => onInsertAtCursor(`@${key}`)}
                      type="button"
                      title="Insert citation key at cursor"
                    >
                      @cite
                    </button>
                    {canEdit ? (
                      <button
                        className={alreadyAdded || alreadyInBib ? styles.addedBtn : styles.addBtn}
                        onClick={() => void handleAddPaper(paper)}
                        disabled={isAdding || alreadyAdded || alreadyInBib}
                        type="button"
                      >
                        {isAdding ? 'Adding…' : alreadyAdded ? 'Added ✓' : alreadyInBib ? 'In .bib' : 'Add to .bib'}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* DOI / arXiv import */}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Import by DOI or arXiv</span>
        <div className={styles.importRow}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Paste DOI, doi.org URL, or arXiv URL/ID"
            value={doiQuery}
            onChange={(e) => setDoiQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleImportDoi() }}
          />
          <button
            className={styles.searchBtn}
            onClick={() => void handleImportDoi()}
            disabled={importing || !doiQuery.trim() || !canEdit}
            type="button"
          >
            {importing ? '…' : 'Import'}
          </button>
        </div>
        {importError ? <p className={styles.errorText}>{importError}</p> : null}
        {importSuccess ? <p className={styles.importStatus}>{importSuccess}</p> : null}
      </div>
    </div>
  )
}
