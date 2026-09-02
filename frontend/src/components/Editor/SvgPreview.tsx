import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import DOMPurify from 'dompurify'
import styles from './SvgPreview.module.css'

/** Parse the aspect ratio (height/width) from a typst SVG string. */
function parseSvgAspectRatio(svg: string): number | null {
  const m = svg.match(/viewBox=["']0\s+0\s+([\d.]+)\s+([\d.]+)["']/)
  if (!m) return null
  const w = parseFloat(m[1])
  const h = parseFloat(m[2])
  return w > 0 && h > 0 ? h / w : null
}

interface Props {
  pages: string[]
  pageCount: number
  pageOffset: number
  compileError: string | null
  isCompiling: boolean
  onTextClick?: (input: { page: number; text: string }) => void
}

export default function SvgPreview({
  pages,
  pageCount,
  pageOffset,
  compileError,
  isCompiling,
  onTextClick,
}: Props) {
  const pageRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const pageViewportRef = useRef<HTMLDivElement | null>(null)
  const [fitMode, setFitMode] = useState<'width' | 'page' | 'custom'>('width')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [activePageIndex, setActivePageIndex] = useState(pageOffset)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  const totalPageCount = Math.max(1, pageCount || pages.length)

  // Aspect ratio (height/width) from the first page SVG — assumed consistent across pages
  const pageAspectRatio = useMemo(() => {
    const first = pages[0]
    return first ? parseSvgAspectRatio(first) : null
  }, [pages])

  // padding-top % is the most reliable cross-browser way to enforce aspect ratio
  // with absolutely-positioned content inside a relatively-positioned container.
  const framePaddingTop = pageAspectRatio ? `${pageAspectRatio * 100}%` : undefined
  const fitWidthPx = Math.max(320, viewportSize.width > 0 ? viewportSize.width - 16 : 880)
  const fitPagePx = Math.max(
    240,
    Math.min(
      fitWidthPx,
      pageAspectRatio && viewportSize.height > 0 ? (viewportSize.height - 32) / pageAspectRatio : fitWidthPx * 0.78,
    ),
  )
  const currentFitZoomPercent = Math.max(10, Math.min(500, Math.round((fitPagePx / fitWidthPx) * 100)))
  const effectiveZoomPercent = fitMode === 'custom' ? zoomPercent : fitMode === 'page' ? currentFitZoomPercent : 100
  const resolvedPageWidthPx = fitMode === 'custom'
    ? Math.max(240, Math.min(2800, (fitWidthPx * zoomPercent) / 100))
    : fitMode === 'page'
      ? fitPagePx
      : fitWidthPx

  useEffect(() => {
    pageRefsRef.current = new Array(pages.length).fill(null)
  }, [pages])

  useEffect(() => {
    const viewport = pageViewportRef.current
    if (!viewport) {
      return
    }

    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }

    updateSize()
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const scrollToPage = useCallback((globalPageIndex: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(0, Math.min(totalPageCount - 1, globalPageIndex))
    setActivePageIndex(clamped)
    if (clamped < pageOffset || clamped >= pageOffset + pages.length) {
      return
    }

    const localIdx = clamped - pageOffset
    const pageElement = pageRefsRef.current[localIdx]
    pageElement?.scrollIntoView({ behavior, block: 'center' })
  }, [pageOffset, pages.length, totalPageCount])

  useEffect(() => {
    setPageInputValue(String(activePageIndex + 1))
  }, [activePageIndex])

  useEffect(() => {
    const viewport = pageViewportRef.current
    if (!viewport || pages.length === 0) {
      return
    }

    const updateActivePage = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const viewportCenter = viewportRect.top + (viewportRect.height / 2)
      let bestPage = pageOffset
      let bestDistance = Number.POSITIVE_INFINITY

      for (let idx = 0; idx < pages.length; idx += 1) {
        const element = pageRefsRef.current[idx]
        if (!element) {
          continue
        }
        const rect = element.getBoundingClientRect()
        const center = rect.top + (rect.height / 2)
        const distance = Math.abs(center - viewportCenter)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPage = pageOffset + idx
        }
      }

      setActivePageIndex(bestPage)
    }

    updateActivePage()
    viewport.addEventListener('scroll', updateActivePage, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', updateActivePage)
    }
  }, [pages, pageOffset])

  const handleZoomIn = useCallback(() => {
    setFitMode('custom')
    setZoomPercent((current) => Math.min(500, current + 10))
  }, [])

  const handleZoomOut = useCallback(() => {
    setFitMode('custom')
    setZoomPercent((current) => Math.max(30, current - 10))
  }, [])

  const handleZoomReset = useCallback(() => {
    setFitMode('custom')
    setZoomPercent(100)
  }, [])

  const handlePageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(event.target.value)
  }, [])

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInputValue, 10)
    if (!Number.isFinite(parsed)) {
      setPageInputValue(String(activePageIndex + 1))
      return
    }

    scrollToPage(parsed - 1, 'smooth')
  }, [activePageIndex, pageInputValue, scrollToPage])

  const handlePageInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitPageInput()
    }
  }, [commitPageInput])

  const handlePreviewClick = useCallback((event: ReactMouseEvent<HTMLDivElement>, page: number) => {
    if (!onTextClick) return
    const target = event.target as HTMLElement | null
    const textNode = target?.closest?.('text,tspan')
    const text = (textNode?.textContent ?? target?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    onTextClick({ page, text: text.slice(0, 240) })
  }, [onTextClick])

  if (compileError && pages.length === 0) {
    return (
      <div className={styles.errorPanel}>
        <div className={styles.errorPanelHeader}>
          <span className={styles.errorPanelTitle}>⚠ Compile Error</span>
        </div>
        <pre className={styles.errorPanelLog}>{compileError}</pre>
      </div>
    )
  }

  if (pages.length === 0 && !isCompiling) {
    return (
      <div className={styles.placeholder}>
        <p>Press <kbd>Ctrl+Enter</kbd> or click Compile to preview</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {isCompiling && <div className={styles.compilingBanner}>Compiling…</div>}
      <div className={styles.previewToolbar}>
        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.toolbarBtn} onClick={handleZoomOut} aria-label="Zoom out">-</button>
          <span className={styles.toolbarMeta}>{effectiveZoomPercent}%</span>
          <button type="button" className={styles.toolbarBtn} onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <button type="button" className={styles.toolbarBtn} onClick={handleZoomReset}>100%</button>
        </div>
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={fitMode === 'width' ? styles.toolbarBtnActive : styles.toolbarBtn}
            onClick={() => setFitMode('width')}
          >
            Fit Width
          </button>
          <button
            type="button"
            className={fitMode === 'page' ? styles.toolbarBtnActive : styles.toolbarBtn}
            onClick={() => setFitMode('page')}
          >
            Fit Page
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.toolbarBtn} onClick={() => scrollToPage(activePageIndex - 1, 'smooth')}>Prev</button>
          <input
            className={styles.toolbarPageInput}
            value={pageInputValue}
            onChange={handlePageInputChange}
            onBlur={commitPageInput}
            onKeyDown={handlePageInputKeyDown}
            inputMode="numeric"
            aria-label="Page number"
          />
          <span className={styles.toolbarMeta}>/ {totalPageCount}</span>
          <button type="button" className={styles.toolbarBtn} onClick={() => scrollToPage(activePageIndex + 1, 'smooth')}>Next</button>
        </div>
      </div>
      <div className={styles.pageViewport} ref={pageViewportRef}>
        {pages.map((_, localIdx) => {
          const globalIdx = pageOffset + localIdx

          return (
            <div
              key={globalIdx}
              ref={(el) => { pageRefsRef.current[localIdx] = el }}
              className={styles.page}
              style={{ width: `${resolvedPageWidthPx}px`, maxWidth: 'none' }}
            >
              {/* Page number badge — appears on hover */}
              <div className={styles.pageLabel} aria-hidden>
                {globalIdx + 1}&thinsp;/&thinsp;{totalPageCount}
              </div>

              {/*
                Aspect-ratio container using the padding-top trick:
                padding-top: X% makes height = width × X/100.
                Children fill it via position:absolute + inset:0.
              */}
              <div
                className={styles.previewFrame}
                style={framePaddingTop ? { paddingTop: framePaddingTop } : { minHeight: '500px' }}
              >
                <div className={styles.previewInner}>
                  <div
                    className={styles.previewSvg}
                    onClick={(event) => handlePreviewClick(event, globalIdx + 1)}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(pages[localIdx] ?? '', { USE_PROFILES: { svg: true, svgFilters: true } }) }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
