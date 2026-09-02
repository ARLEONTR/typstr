import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../api/client'
import styles from './GlobalSearchModal.module.css'

interface GlobalSearchResult {
  projectId: string
  projectTitle: string
  fileId: string
  filePath: string
  lineNumber: number
  column: number
  lineText: string
}

interface GlobalSearchResponse {
  results: GlobalSearchResult[]
}

export function GlobalSearchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 3) {
      setResults([])
      setLoading(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true)
        setError(null)
        const { data } = await apiClient.get<GlobalSearchResponse>('/api/projects/search', {
          params: { q: q.trim() },
        })
        setResults(data.results)
      } catch {
        setError('Search failed. Try again.')
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  function handleQueryChange(value: string) {
    setQuery(value)
    search(value)
  }

  function handleResultClick(result: GlobalSearchResult) {
    const params = new URLSearchParams({
      search: query.trim(),
      fileId: result.fileId,
      line: String(result.lineNumber),
      col: String(result.column),
    })
    navigate(`/projects/${result.projectId}?${params.toString()}`)
    onClose()
  }

  const grouped = groupByProject(results)

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search across all projects… (min 3 chars)"
          />
          {loading && <span className={styles.spinner} />}
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {!loading && query.trim().length >= 3 && results.length === 0 && !error && (
          <p className={styles.empty}>No matches found.</p>
        )}

        {grouped.length > 0 && (
          <div className={styles.results}>
            {grouped.map((group) => (
              <div key={group.projectId} className={styles.group}>
                <div className={styles.groupHeader}>{group.projectTitle}</div>
                {group.results.map((result, idx) => (
                  <button
                    key={`${result.fileId}-${result.lineNumber}-${idx}`}
                    className={styles.resultRow}
                    onClick={() => handleResultClick(result)}
                  >
                    <span className={styles.filePath}>{result.filePath}</span>
                    <span className={styles.lineNum}>:{result.lineNumber}</span>
                    <span className={styles.lineText}>{highlightMatch(result.lineText, query)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function groupByProject(results: GlobalSearchResult[]) {
  const map = new Map<string, { projectId: string; projectTitle: string; results: GlobalSearchResult[] }>()
  for (const r of results) {
    if (!map.has(r.projectId)) {
      map.set(r.projectId, { projectId: r.projectId, projectTitle: r.projectTitle, results: [] })
    }
    map.get(r.projectId)!.results.push(r)
  }
  return Array.from(map.values())
}

function highlightMatch(lineText: string, query: string): ReactNode {
  const lower = lineText.toLowerCase()
  const lowerQuery = query.trim().toLowerCase()
  const idx = lower.indexOf(lowerQuery)
  if (idx === -1) return lineText
  return (
    <>
      {lineText.slice(0, idx)}
      <mark>{lineText.slice(idx, idx + lowerQuery.length)}</mark>
      {lineText.slice(idx + lowerQuery.length)}
    </>
  )
}
