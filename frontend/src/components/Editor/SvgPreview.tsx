import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import styles from './SvgPreview.module.css'
import { sanitizePreviewSvg } from './svgSanitize'

/** Parse the page size (in points) from a typst SVG string. */
function parseSvgPageSize(svg: string): { width: number; height: number } | null {
  const m = svg.match(/viewBox=["']0\s+0\s+([\d.]+)\s+([\d.]+)["']/)
  if (!m) return null
  const width = parseFloat(m[1])
  const height = parseFloat(m[2])
  return width > 0 && height > 0 ? { width, height } : null
}

// Only pages this close to the visible one are put into the DOM; the rest
// keep an empty frame of the right size. A large document otherwise holds
// tens of thousands of SVG nodes (hundreds of MB) for pages nobody sees.
const PAGE_RENDER_RADIUS = 2

interface Props {
  pages: string[]
  pageCount: number
  pageOffset: number
  compileError: string | null
  isCompiling: boolean
  /** `page` is the index in `pages`, `run` the text run on it, `offset` the clicked character. */
  onTextClick?: (input: { page: number; run: number; text: string; offset: number }) => void
  /** Scroll to and highlight a text run (`page` is the index in `pages`). */
  reveal?: { page: number; run: number; nonce: number } | null
}

export default function SvgPreview({
  pages,
  pageCount,
  pageOffset,
  compileError,
  isCompiling,
  onTextClick,
  reveal,
}: Props) {
  const pageRefsRef = useRef<(HTMLDivElement | null)[]>([])
  const pageViewportRef = useRef<HTMLDivElement | null>(null)
  const [fitMode, setFitMode] = useState<'width' | 'page' | 'custom'>('width')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [activePageIndex, setActivePageIndex] = useState(pageOffset)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  const totalPageCount = Math.max(1, pageCount || pages.length)

  const safePages = useMemo(() => pages.map(sanitizePreviewSvg), [pages])

  // Aspect ratio (height/width) of every page: a document can mix portrait
  // and landscape pages, and a landscape page in a portrait frame was shrunk
  // to a strip in the middle of it.
  const pageSizes = useMemo(() => pages.map(parseSvgPageSize), [pages])
  const defaultPageSize = pageSizes.find((size) => size !== null) ?? null
  const pageSizeOf = (localIdx: number) => pageSizes[localIdx] ?? defaultPageSize
  const aspectRatioOf = (localIdx: number) => {
    const size = pageSizeOf(localIdx)
    return size ? size.height / size.width : null
  }

  const fitWidthPx = Math.max(320, viewportSize.width > 0 ? viewportSize.width - 16 : 880)
  const fitPagePxFor = (aspectRatio: number | null) => Math.max(
    240,
    Math.min(
      fitWidthPx,
      aspectRatio && viewportSize.height > 0 ? (viewportSize.height - 32) / aspectRatio : fitWidthPx * 0.78,
    ),
  )
  const activeAspectRatio = aspectRatioOf(activePageIndex - pageOffset)
  const currentFitZoomPercent = Math.max(10, Math.min(500, Math.round((fitPagePxFor(activeAspectRatio) / fitWidthPx) * 100)))
  const effectiveZoomPercent = fitMode === 'custom' ? zoomPercent : fitMode === 'page' ? currentFitZoomPercent : 100
  // A zoom level keeps one scale for all pages, so a landscape page is wider
  // than a portrait one; the fit modes fit every page on its own.
  const pageWidthPxFor = (localIdx: number) => {
    if (fitMode === 'page') return fitPagePxFor(aspectRatioOf(localIdx))
    if (fitMode !== 'custom') return fitWidthPx
    const relativeWidth = (pageSizeOf(localIdx)?.width ?? 1) / (defaultPageSize?.width ?? 1)
    return Math.max(240, Math.min(4000, (fitWidthPx * zoomPercent * relativeWidth) / 100))
  }

  // Ref callbacks assign the page elements during commit; clearing the array
  // in an effect afterwards wiped them on every recompile, so the visible page
  // was lost (the indicator fell back to page 1 and the wrong pages were
  // rendered). Only drop entries for pages that no longer exist.
  useEffect(() => {
    pageRefsRef.current.length = pages.length
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
    pageElement?.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
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
    // The text layer (.tsel) lies over the glyphs; find the character under
    // the pointer so the editor can go to that letter.
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let node: Node | null = null
    let offset = 0
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
    if (position) {
      node = position.offsetNode
      offset = position.offset
    } else {
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
      if (range) {
        node = range.startContainer
        offset = range.startOffset
      }
    }
    let run = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element | null)?.closest?.('.tsel') ?? null
    if (!run) {
      run = (event.target as Element | null)?.closest?.('.tsel') ?? null
      offset = 0
    }
    const text = run?.textContent ?? ''
    if (!text.trim()) return
    if (node && run?.contains(node) && node.nodeType === Node.TEXT_NODE) {
      // Count the characters of earlier text nodes in the same run.
      const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT)
      let before = 0
      for (let current = walker.nextNode(); current && current !== node; current = walker.nextNode()) {
        before += current.textContent?.length ?? 0
      }
      offset += before
    }
    const pageElement = run?.closest(`.${styles.page}`)
    const runIndex = pageElement ? [...pageElement.querySelectorAll('.tsel')].indexOf(run as Element) : -1
    if (runIndex === -1) return
    onTextClick({ page: page - 1 - pageOffset, run: runIndex, text, offset: Math.min(offset, text.length) })
  }, [onTextClick, pageOffset])

  // Editor -> preview: scroll to the text run and flash it. A request is
  // carried out once (when its page is rendered) or dropped after a short
  // while, so it can never move the preview later, during editing.
  const [highlight, setHighlight] = useState<{ page: number; run: number; expiresAt: number; scrolled: boolean } | null>(null)
  useEffect(() => {
    if (!reveal) return
    setHighlight({ page: reveal.page, run: reveal.run, expiresAt: Date.now() + 2000, scrolled: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce])
  useEffect(() => {
    if (!highlight) return
    if (Date.now() > highlight.expiresAt) {
      setHighlight(null)
      return
    }
    const pageElement = pageRefsRef.current[highlight.page]
    const target = pageElement?.querySelectorAll<HTMLElement>('.tsel')[highlight.run]
    if (!target) {
      // Not rendered yet: bring the page into view first (pages near the
      // visible one only are rendered).
      if (!highlight.scrolled) {
        scrollToPage(highlight.page + pageOffset, 'auto')
        setHighlight({ ...highlight, scrolled: true })
      }
      return
    }
    // Scroll vertically only: the text layer is much wider than the line it
    // covers, and scrollIntoView also scrolled the preview sideways.
    const viewport = pageViewportRef.current
    const box = (target.closest('foreignObject') ?? target).getBoundingClientRect()
    if (viewport) {
      const viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTo({ top: viewport.scrollTop + box.top - viewportRect.top - viewportRect.height / 2 + box.height / 2, behavior: 'smooth' })
    }
    target.classList.add(styles.syncFlash)
    window.setTimeout(() => target.classList.remove(styles.syncFlash), 1600)
    setHighlight(null)
  }, [highlight, safePages, activePageIndex, pageOffset, scrollToPage])

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
          const isRendered = Math.abs(globalIdx - activePageIndex) <= PAGE_RENDER_RADIUS
          const aspectRatio = aspectRatioOf(localIdx)

          return (
            <div
              key={globalIdx}
              ref={(el) => { pageRefsRef.current[localIdx] = el }}
              className={styles.page}
              style={{ width: `${pageWidthPxFor(localIdx)}px`, maxWidth: 'none' }}
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
                style={aspectRatio ? { paddingTop: `${aspectRatio * 100}%` } : { minHeight: '500px' }}
              >
                <div className={styles.previewInner}>
                  <div
                    className={styles.previewSvg}
                    onClick={(event) => handlePreviewClick(event, globalIdx + 1)}
                    dangerouslySetInnerHTML={{ __html: isRendered ? safePages[localIdx] ?? '' : '' }}
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
