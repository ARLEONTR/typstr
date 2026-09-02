import { useState, useCallback, useRef } from 'react'
import { apiClient } from '../../api/client'
import { Check, Database, ExternalLink, Search } from '../../icons'
import styles from './BibliographyPanel.module.css'

interface AcademicPaper {
  id: string
  source: 'arxiv' | 'dblp'
  title: string
  authors: string[]
  year: string | null
  venue: string | null
  doi: string | null
  url: string | null
  citationCount?: number | null
  bibEntry: string | null
}

interface Props {
  projectId: string
  canEdit: boolean
  citationKeys: Set<string>
  onAddBibEntry: (entry: string) => Promise<void>
  onInsertAtCursor: (text: string) => void
}

function buildBibKey(paper: AcademicPaper): string {
  const lastName = (paper.authors[0] ?? '').split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'
  const year = paper.year ?? 'nd'
  const firstWord = paper.title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? 'untitled'
  return `${lastName}${year}${firstWord}`
}

export default function AcademicPanel({ projectId, canEdit, citationKeys, onAddBibEntry, onInsertAtCursor }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AcademicPaper[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addedKeys, setAddedKeys] = useState(new Set<string>())
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const [arxivRes, dblpRes] = await Promise.all([
        apiClient.get<{ data?: AcademicPaper[] }>(`/api/projects/${projectId}/ecosystem/arxiv-search`, { params: { q } }),
        apiClient.get<{ data?: AcademicPaper[] }>(`/api/projects/${projectId}/ecosystem/dblp-search`, { params: { q } }),
      ])
      let data = [...(arxivRes.data.data ?? []), ...(dblpRes.data.data ?? [])]
      // Sort by citationCount (academic rank), fallback to year desc
      data.sort((a, b) => {
        if ((b.citationCount ?? 0) !== (a.citationCount ?? 0)) {
          return (b.citationCount ?? 0) - (a.citationCount ?? 0)
        }
        return (parseInt(b.year ?? '0', 10) || 0) - (parseInt(a.year ?? '0', 10) || 0)
      })
      setResults(data)
    } catch (err) {
      setSearchError('Search failed')
    } finally {
      setSearching(false)
    }
  }, [projectId, query])

  const handleAddPaper = useCallback(async (paper: AcademicPaper) => {
    const key = buildBibKey(paper)
    setAddingKey(key)
    try {
      if (paper.bibEntry) {
        await onAddBibEntry(paper.bibEntry)
        setAddedKeys((prev) => new Set([...prev, key]))
      }
    } finally {
      setAddingKey(null)
    }
  }, [onAddBibEntry])

  const isKeyInBib = (key: string) => citationKeys.has(key.toLowerCase())

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}></span>
        </div>
        <div className={styles.scholarSearchRow}>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="search"
            placeholder="Paper title, author, keyword… (arXiv, DBLP)"
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
            title={searching ? 'Searching papers' : 'Search papers'}
            aria-label={searching ? 'Searching papers' : 'Search papers'}
          >
            <Search size={15} aria-hidden />
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
              const doi = paper.doi
              const venue = paper.venue ?? ''
              return (
                <div key={paper.id} className={styles.scholarCard}>
                  <p className={styles.scholarTitle}>{paper.title}</p>
                  <p className={styles.scholarAuthors}>
                    {paper.authors.slice(0, 3).join(', ')}
                    {paper.authors.length > 3 ? ' et al.' : ''}
                    {paper.year ? ` · ${paper.year}` : ''}
                    {venue ? ` · ${venue}` : ''}
                  </p>
                  <div className={styles.scholarActions}>
                    {doi ? (
                      <a className={styles.ghostBtn} href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" title="Open DOI" aria-label="Open DOI">
                        <ExternalLink size={15} aria-hidden />
                      </a>
                    ) : null}
                    <button
                      className={styles.ghostBtn}
                      onClick={() => onInsertAtCursor(`@${key}`)}
                      type="button"
                      title="Insert citation key at cursor"
                      aria-label="Insert citation key at cursor"
                    >
                      <span className={styles.iconBtnText}>@</span>
                    </button>
                    {canEdit ? (
                      <button
                        className={alreadyAdded || alreadyInBib ? styles.addedBtn : styles.addBtn}
                        onClick={() => void handleAddPaper(paper)}
                        disabled={isAdding || alreadyAdded || alreadyInBib}
                        type="button"
                        title={isAdding ? 'Adding to bibliography' : alreadyAdded ? 'Added to bibliography' : alreadyInBib ? 'Already in bibliography' : 'Add to bibliography'}
                        aria-label={isAdding ? 'Adding to bibliography' : alreadyAdded ? 'Added to bibliography' : alreadyInBib ? 'Already in bibliography' : 'Add to bibliography'}
                      >
                        {isAdding || alreadyAdded || alreadyInBib ? <Check size={15} aria-hidden /> : <Database size={15} aria-hidden />}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
