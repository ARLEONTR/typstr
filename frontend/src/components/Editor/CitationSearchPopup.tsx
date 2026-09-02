import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../api/client'
import styles from './CitationSearchPopup.module.css'

export interface CitationSearchResult {
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
  citationCount?: number | null
  academicRank?: number | null // for sorting
}

type Tab = 'arxiv' | 'dblp'

interface Props {
  projectId: string
  query: string
  defaultTab?: Tab
  existingKeys: Set<string>
  anchorRect: DOMRect | null
  onSelect: (result: CitationSearchResult) => void
  onClose: () => void
}

function extractBibKeyFromEntry(entry: string): string | null {
  const m = entry.match(/@\w+\{([^,\s]+)/)
  return m?.[1] ?? null
}

export default function CitationSearchPopup({ projectId, query, existingKeys, anchorRect, onSelect, onClose }: Props) {
  const [results, setResults] = useState<CitationSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)


  // Combined search for arxiv and dblp, sorted by academic rank (citationCount desc, fallback to year desc)
  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)
    setResults([])
    setExpandedAbstract(null)

    try {
      const [arxivSettled, dblpSettled] = await Promise.allSettled([
        apiClient.get<{ data: CitationSearchResult[] }>(
          `/api/projects/${projectId}/ecosystem/arxiv-search`,
          { params: { q }, signal: controller.signal },
        ),
        apiClient.get<{ data: CitationSearchResult[] }>(
          `/api/projects/${projectId}/ecosystem/dblp-search`,
          { params: { q }, signal: controller.signal },
        ),
      ])
      const arxivData = arxivSettled.status === 'fulfilled' ? (arxivSettled.value.data.data ?? []) : []
      const dblpData = dblpSettled.status === 'fulfilled' ? (dblpSettled.value.data.data ?? []) : []
      const partialFailure = arxivSettled.status === 'rejected' || dblpSettled.status === 'rejected'
      if (partialFailure && arxivData.length === 0 && dblpData.length === 0) {
        if (!controller.signal.aborted) setError('Both search sources unavailable. Try again later.')
        return
      }
      if (partialFailure && !controller.signal.aborted) {
        const failed = arxivSettled.status === 'rejected' ? 'arXiv' : 'DBLP'
        setError(`${failed} unavailable — showing partial results.`)
      }
      let data = [...arxivData, ...dblpData]
      // Sort by citationCount (academic rank), fallback to year desc
      data.sort((a, b) => {
        if ((b.citationCount ?? 0) !== (a.citationCount ?? 0)) {
          return (b.citationCount ?? 0) - (a.citationCount ?? 0)
        }
        return (parseInt(b.year ?? '0', 10) || 0) - (parseInt(a.year ?? '0', 10) || 0)
      })
      if (!controller.signal.aborted) {
        setResults(data)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError('Search failed.')
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const id = setTimeout(() => { void search(query) }, 300)
    return () => clearTimeout(id)
  }, [query, search])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: Math.min(anchorRect.bottom + 4, window.innerHeight - 420),
        left: Math.max(4, Math.min(anchorRect.left, window.innerWidth - 440)),
      }
    : { position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)' }

  return (
    <div ref={popupRef} className={styles.popup} style={style} role="dialog" aria-label="Citation search">
      <div className={styles.header}>
        <span className={styles.headerTitle}>Cite paper</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>


      {/* Tabs removed: always show combined results from arxiv and dblp */}

      <div className={styles.body}>
        {isLoading ? (
          <div className={styles.statusRow}><span className={styles.spinner} />Searching…</div>
        ) : error && results.length === 0 ? (
          <div className={styles.errorRow}>{error}</div>
        ) : results.length === 0 && query.trim() ? (
          <div className={styles.statusRow}>No results for "{query}"</div>
        ) : results.length === 0 ? (
          <div className={styles.statusRow}>Type to search</div>
        ) : (
          <>
          {error && results.length > 0 ? (
            <div className={styles.warnRow}>{error}</div>
          ) : null}
          <ul className={styles.list} style={{ maxHeight: 320, overflowY: 'auto' }}>
            {results.slice(0, 5).map((r, index) => {
              const key = r.bibEntry ? extractBibKeyFromEntry(r.bibEntry) : null
              const alreadyAdded = key ? existingKeys.has(key.toLowerCase()) : false
              return (
                <li key={`${r.id}-${index}`} className={styles.item}>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemSource}>{r.source}</span>
                    {r.year ? <span className={styles.itemYear}>{r.year}</span> : null}
                    {r.venue ? <span className={styles.itemVenue}>{r.venue}</span> : null}
                    {r.citationCount != null ? (
                      <span className={styles.itemCitations} title="Citation count">
                        {r.citationCount >= 1000
                          ? `${(r.citationCount / 1000).toFixed(1)}k`
                          : r.citationCount} cited
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.itemTitle}>{r.title}</p>
                  {r.authors.length ? (
                    <p className={styles.itemAuthors}>{r.authors.slice(0, 4).join(', ')}{r.authors.length > 4 ? ' et al.' : ''}</p>
                  ) : null}
                  {r.abstract ? (
                    <div className={styles.abstractRow}>
                      <button
                        className={styles.abstractToggle}
                        onClick={() => setExpandedAbstract(expandedAbstract === r.id ? null : r.id)}
                      >
                        {expandedAbstract === r.id ? 'Hide abstract' : 'Show abstract'}
                      </button>
                      {expandedAbstract === r.id ? (
                        <p className={styles.abstract}>{r.abstract}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={styles.itemActions}>
                    {r.url ? (
                      <a className={styles.itemLink} href={r.url} target="_blank" rel="noopener noreferrer">
                        Open ↗
                      </a>
                    ) : null}
                    <button
                      className={[styles.addBtn, alreadyAdded ? styles.addBtnAdded : ''].filter(Boolean).join(' ')}
                      onClick={() => onSelect(r)}
                    >
                      {alreadyAdded ? '✓ Cite (in bib)' : 'Add & cite'}
                    </button>
                  </div>
                </li>
              )
            })}
            {results.length > 5 && (
              <li className={styles.item} style={{ textAlign: 'center', color: 'var(--muted-text)' }}>Scroll for more…</li>
            )}
          </ul>
          </>
        )}
      </div>
    </div>
  )
}
