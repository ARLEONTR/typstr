import { useState, useCallback, useRef } from 'react'
import { apiClient } from '../../api/client'
import styles from './BibliographyPanel.module.css'

interface DblpAuthor {
  name: string
}

interface DblpPaper {
  id: string
  title: string
  authors: DblpAuthor[]
  year: string | null
  venue: string | null
  doi: string | null
  url: string | null
  citationCount?: number
  bibEntry: string | null
}

interface Props {
  projectId: string
  canEdit: boolean
  citationKeys: Set<string>
  onAddBibEntry: (entry: string) => Promise<void>
  onInsertAtCursor: (text: string) => void
}

function buildBibKey(paper: DblpPaper): string {
  const lastName = (paper.authors[0]?.name ?? '').split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'
  const year = paper.year ?? 'nd'
  const firstWord = paper.title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? 'untitled'
  return `${lastName}${year}${firstWord}`
}

function buildBibEntry(paper: DblpPaper): string {
  const key = buildBibKey(paper)
  const entryType = 'inproceedings'
  const venue = paper.venue ?? ''
  const doi = paper.doi
  const lines: string[] = [`@${entryType}{${key},`]
  lines.push(`  title     = {${paper.title}},`)
  if (paper.authors.length > 0) lines.push(`  author    = {${paper.authors.map((a) => a.name).join(' and ')}},`)
  if (paper.year) lines.push(`  year      = {${paper.year}},`)
  if (venue) lines.push(`  booktitle = {${venue}},`)
  if (doi) lines.push(`  doi       = {${doi}},`)
  lines.push('}')
  return lines.join('\n')
}

export default function DblpPanel({ projectId, canEdit, citationKeys, onAddBibEntry, onInsertAtCursor }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DblpPaper[]>([])
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
      const res = await apiClient.get<{ data?: DblpPaper[] }>(`/api/projects/${projectId}/ecosystem/dblp-search`, { params: { q } })
      setResults(res.data.data ?? [])
    } catch (err) {
      setSearchError('Search failed')
    } finally {
      setSearching(false)
    }
  }, [projectId, query])

  const handleAddPaper = useCallback(async (paper: DblpPaper) => {
    const key = buildBibKey(paper)
    setAddingKey(key)
    try {
      await onAddBibEntry(buildBibEntry(paper))
      setAddedKeys((prev) => new Set([...prev, key]))
    } finally {
      setAddingKey(null)
    }
  }, [onAddBibEntry])

  const isKeyInBib = (key: string) => citationKeys.has(key.toLowerCase())

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>DBLP</span>
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
              const doi = paper.doi
              const venue = paper.venue ?? ''
              return (
                <div key={paper.id} className={styles.scholarCard}>
                  <p className={styles.scholarTitle}>{paper.title}</p>
                  <p className={styles.scholarAuthors}>
                    {paper.authors.slice(0, 3).map((a) => a.name).join(', ')}
                    {paper.authors.length > 3 ? ' et al.' : ''}
                    {paper.year ? ` · ${paper.year}` : ''}
                    {venue ? ` · ${venue}` : ''}
                  </p>
                  <div className={styles.scholarActions}>
                    {doi ? (
                      <a className={styles.ghostBtn} href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">DOI ↗</a>
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
    </div>
  )
}
