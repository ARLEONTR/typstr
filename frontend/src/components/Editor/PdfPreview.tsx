import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { ProjectComment, ProjectCommentPdfAnnotation, ProjectCommentPdfStroke } from '../../types'
import styles from './PdfPreview.module.css'
import 'react-pdf/dist/Page/TextLayer.css'
// Keep this import on the public pdfjs-dist export path. package.json pins
// pdfjs-dist to React-PDF's PDF.js version so API/worker versions match.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Props {
  pdfUrl: string | null
  compileError: string | null
  isCompiling: boolean
  comments?: ProjectComment[]
  highlightedCommentId?: string | null
  canWriteInkComments?: boolean
  onCreateInkComment?: (input: { annotation: ProjectCommentPdfAnnotation; content: string }) => Promise<void> | void
  onCommentSelect?: (comment: ProjectComment) => void
  onPageCountChange?: (pageCount: number) => void
  onPreviewClick?: (input: { page: number; x: number; y: number; pdfX?: number; pdfY?: number; text?: string; textOffset?: number }) => void
  syncTarget?: { page: number; y?: number; nonce: number } | null
}

type DraftStroke = {
  points: Array<{ x: number; y: number }>
}

export default function PdfPreview({
  pdfUrl,
  compileError,
  isCompiling,
  comments = [],
  highlightedCommentId = null,
  canWriteInkComments = false,
  onCreateInkComment,
  onCommentSelect,
  onPageCountChange,
  onPreviewClick,
  syncTarget,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const pageDimensionsRef = useRef(new Map<number, { width: number; height: number }>())
  const activeStrokeRef = useRef<{ pointerId: number; page: number } | null>(null)
  const [pageWidth, setPageWidth] = useState(720)
  const [pageCount, setPageCount] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [supportsInkInput, setSupportsInkInput] = useState(false)
  const [isInkMode, setIsInkMode] = useState(false)
  const [draftPage, setDraftPage] = useState<number | null>(null)
  const [draftStrokes, setDraftStrokes] = useState<DraftStroke[]>([])
  const [draftText, setDraftText] = useState('')
  const [isSavingInk, setIsSavingInk] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const sync = () => setSupportsInkInput(mediaQuery.matches || navigator.maxTouchPoints > 0)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }

    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  useEffect(() => {
    const element = scrollerRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? element.clientWidth
      setPageWidth(Math.max(260, Math.floor(nextWidth - 24)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setRenderError(null)
    setPageCount(0)
    onPageCountChange?.(0)
    setIsInkMode(false)
    setDraftPage(null)
    setDraftStrokes([])
    setDraftText('')
  }, [onPageCountChange, pdfUrl])

  const pdfComments = useMemo(
    () => comments.filter((comment) => comment.pdfAnnotation?.kind === 'ink'),
    [comments],
  )

  useEffect(() => {
    if (!highlightedCommentId) {
      return
    }

    const highlightedComment = pdfComments.find((comment) => comment.id === highlightedCommentId)
    const page = highlightedComment?.pdfAnnotation?.page
    if (!page) {
      return
    }

    pageRefs.current.get(page)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightedCommentId, pdfComments])

  useEffect(() => {
    if (!syncTarget?.page) {
      return
    }

    const page = pageRefs.current.get(syncTarget.page)
    const scroller = scrollerRef.current
    if (!page || !scroller) {
      return
    }

    const pageTop = page.offsetTop
    const targetY = typeof syncTarget.y === 'number'
      ? syncTarget.y * page.offsetHeight
      : page.offsetHeight / 2
    scroller.scrollTo({
      top: Math.max(0, pageTop + targetY - scroller.clientHeight / 2),
      behavior: 'smooth',
    })
  }, [syncTarget?.nonce, syncTarget?.page])

  if (isCompiling) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.spinner} />
        <span>Compiling…</span>
      </div>
    )
  }

  if (compileError && !pdfUrl) {
    return (
      <div className={styles.placeholder}>
        <p>Open the compile output panel to review the latest compiler messages.</p>
      </div>
    )
  }

  if (!pdfUrl) {
    return (
      <div className={styles.placeholder}>
        <p>Press <kbd>Ctrl+Enter</kbd> or click <strong>▶ Compile</strong> to preview</p>
      </div>
    )
  }

  const showInkControls = canWriteInkComments && supportsInkInput && Boolean(onCreateInkComment)

  return (
    <div className={styles.container}>
      {compileError ? (
        <div className={styles.inlineErrorBanner}>
          <strong>Compilation reported issues.</strong>
          <span>The latest PDF is still shown below.</span>
        </div>
      ) : null}

      {showInkControls ? (
        <div className={styles.pdfToolbar}>
          <>
            <button
              className={isInkMode ? styles.inkModeButtonActive : styles.inkModeButton}
              onClick={() => {
                setIsInkMode((current) => !current)
                setDraftPage(null)
                setDraftStrokes([])
                setDraftText('')
              }}
            >
              {isInkMode ? 'Exit note mode' : 'Handwrite note'}
            </button>
            <span className={styles.toolbarHint}>
              {isInkMode
                ? draftPage ? `Drawing on page ${draftPage}. Save or discard this note before moving on.` : 'Use Apple Pencil, stylus, or touch to draw directly on the preview.'
                : 'On tablet devices, handwritten notes are saved as project comments.'}
            </span>
          </>
        </div>
      ) : null}

      {draftPage ? (
        <div className={styles.inkComposer}>
          <div className={styles.inkComposerHeader}>
            <strong>Handwritten note on page {draftPage}</strong>
            <span>{countStrokePoints(draftStrokes)} points</span>
          </div>
          <textarea
            className={styles.inkComposerInput}
            rows={3}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="Optional note text. Leave blank to save it as “Handwritten note”."
            maxLength={5000}
          />
          <div className={styles.inkComposerActions}>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                setDraftPage(null)
                setDraftStrokes([])
                setDraftText('')
              }}
              disabled={isSavingInk}
            >
              Discard
            </button>
            <button
              className={styles.primaryAction}
              onClick={async () => {
                if (!draftPage || !onCreateInkComment) {
                  return
                }

                const annotation = buildInkAnnotation(draftPage, draftStrokes)
                if (!annotation) {
                  return
                }

                setIsSavingInk(true)
                try {
                  await onCreateInkComment({
                    annotation,
                    content: draftText,
                  })
                  setDraftPage(null)
                  setDraftStrokes([])
                  setDraftText('')
                  setIsInkMode(false)
                } finally {
                  setIsSavingInk(false)
                }
              }}
              disabled={isSavingInk || draftStrokes.length === 0}
            >
              {isSavingInk ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      ) : null}

      {renderError ? (
        <div className={styles.error}>
          <strong>Unable to render PDF preview.</strong>
          <pre className={styles.errorPre}>{renderError}</pre>
        </div>
      ) : null}

      <div ref={scrollerRef} className={styles.pdfScroller}>
        <Document
          file={pdfUrl}
          loading={<div className={styles.placeholder}><div className={styles.spinner} /><span>Loading PDF…</span></div>}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
            setRenderError(null)
            onPageCountChange?.(numPages)
          }}
          onLoadError={(error) => setRenderError(error.message || 'Failed to load PDF.')}
        >
          {Array.from({ length: pageCount }, (_, index) => {
            const pageNumber = index + 1
            const pageComments = pdfComments.filter((comment) => comment.pdfAnnotation?.page === pageNumber)
            const isDraftPage = draftPage === pageNumber

            return (
              <div
                key={pageNumber}
                ref={(node) => {
                  if (node) {
                    pageRefs.current.set(pageNumber, node)
                  } else {
                    pageRefs.current.delete(pageNumber)
                  }
                }}
                className={styles.pageCard}
              >
                <div className={styles.pageViewport}>
                  <Page
                    pageNumber={pageNumber}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={Boolean(onPreviewClick)}
                    loading={<div className={styles.pageLoading}>Rendering page…</div>}
                    onLoadSuccess={(page: any) => {
                      pageDimensionsRef.current.set(pageNumber, {
                        width: page.originalWidth || (page.view ? page.view[2] : 0),
                        height: page.originalHeight || (page.view ? page.view[3] : 0),
                      })
                    }}
                  />

                  <svg
                    className={isInkMode ? styles.pageOverlayDrawing : styles.pageOverlay}
                    viewBox={`0 0 ${pageWidth} 1000`}
                    preserveAspectRatio="none"
                    onPointerDown={(event) => handlePointerDown(event, pageNumber, isInkMode, draftPage, setDraftPage, setDraftStrokes, activeStrokeRef)}
                    onPointerMove={(event) => handlePointerMove(event, pageNumber, activeStrokeRef, setDraftStrokes)}
                    onPointerUp={(event) => handlePointerEnd(event, activeStrokeRef, setDraftStrokes)}
                    onPointerCancel={(event) => handlePointerEnd(event, activeStrokeRef, setDraftStrokes)}
                    onClick={(event) => {
                      if (isInkMode || !onPreviewClick) {
                        return
                      }
                      const point = eventToNormalizedPoint(event)
                      if (!point) {
                        return
                      }
                      const textHit = getPdfTextHit(event)
                      const dims = pageDimensionsRef.current.get(pageNumber)
                      onPreviewClick({
                        page: pageNumber,
                        x: point.x,
                        y: point.y,
                        pdfX: dims ? point.x * dims.width : undefined,
                        pdfY: dims ? point.y * dims.height : undefined,
                        text: textHit?.text,
                        textOffset: textHit?.offset,
                      })
                    }}
                  >
                    {pageComments.map((comment) => {
                      const annotation = comment.pdfAnnotation
                      if (!annotation) {
                        return null
                      }

                      return (
                        <g
                          key={comment.id}
                          className={comment.id === highlightedCommentId ? styles.annotationGroupActive : styles.annotationGroup}
                          onClick={(event) => {
                            event.stopPropagation()
                            onCommentSelect?.(comment)
                          }}
                        >
                          {annotation.strokes.map((stroke, strokeIndex) => (
                            <path
                              key={`${comment.id}:${strokeIndex}`}
                              d={strokeToPath(stroke, pageWidth, 1000)}
                              className={styles.annotationStroke}
                              style={{ stroke: annotation.color }}
                            />
                          ))}
                          <rect
                            className={styles.annotationBounds}
                            x={annotation.bounds.x * pageWidth}
                            y={annotation.bounds.y * 1000}
                            width={annotation.bounds.width * pageWidth}
                            height={annotation.bounds.height * 1000}
                          />
                          <foreignObject
                            x={Math.max(0, annotation.bounds.x * pageWidth)}
                            y={Math.max(0, annotation.bounds.y * 1000 - 34)}
                            width={Math.min(pageWidth * 0.7, 240)}
                            height={32}
                          >
                            <button className={styles.annotationChip} type="button">
                              {comment.authorName}: {comment.content}
                            </button>
                          </foreignObject>
                        </g>
                      )
                    })}

                    {isDraftPage ? draftStrokes.map((stroke, strokeIndex) => (
                      <path
                        key={`draft:${strokeIndex}`}
                        d={strokeToPath(stroke, pageWidth, 1000)}
                        className={styles.draftStroke}
                      />
                    )) : null}
                  </svg>
                </div>
              </div>
            )
          })}
        </Document>
      </div>
    </div>
  )
}

function handlePointerDown(
  event: ReactPointerEvent<SVGSVGElement>,
  pageNumber: number,
  isInkMode: boolean,
  draftPage: number | null,
  setDraftPage: (page: number) => void,
  setDraftStrokes: Dispatch<SetStateAction<DraftStroke[]>>,
  activeStrokeRef: MutableRefObject<{ pointerId: number; page: number } | null>,
) {
  if (!isInkMode || (draftPage !== null && draftPage !== pageNumber)) {
    return
  }

  if (event.pointerType === 'mouse' && !event.altKey) {
    return
  }

  const point = eventToNormalizedPoint(event)
  if (!point) {
    return
  }

  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  activeStrokeRef.current = { pointerId: event.pointerId, page: pageNumber }
  setDraftPage(pageNumber)
  setDraftStrokes((current) => [...current, { points: [point] }])
}

function handlePointerMove(
  event: ReactPointerEvent<SVGSVGElement>,
  pageNumber: number,
  activeStrokeRef: MutableRefObject<{ pointerId: number; page: number } | null>,
  setDraftStrokes: Dispatch<SetStateAction<DraftStroke[]>>,
) {
  if (!activeStrokeRef.current || activeStrokeRef.current.pointerId !== event.pointerId || activeStrokeRef.current.page !== pageNumber) {
    return
  }

  const point = eventToNormalizedPoint(event)
  if (!point) {
    return
  }

  event.preventDefault()
  setDraftStrokes((current) => {
    if (current.length === 0) {
      return current
    }

    const next = [...current]
    const lastStroke = next[next.length - 1]
    next[next.length - 1] = {
      points: [...lastStroke.points, point],
    }
    return next
  })
}

function handlePointerEnd(
  event: ReactPointerEvent<SVGSVGElement>,
  activeStrokeRef: MutableRefObject<{ pointerId: number; page: number } | null>,
  setDraftStrokes: Dispatch<SetStateAction<DraftStroke[]>>,
) {
  if (!activeStrokeRef.current || activeStrokeRef.current.pointerId !== event.pointerId) {
    return
  }

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const point = eventToNormalizedPoint(event)
  setDraftStrokes((current) => {
    if (current.length === 0) {
      return current
    }

    const next = [...current]
    const lastStroke = next[next.length - 1]
    if (point && lastStroke.points.length === 1) {
      next[next.length - 1] = {
        points: [...lastStroke.points, point],
      }
    }
    return next
  })
  activeStrokeRef.current = null
}

function eventToNormalizedPoint(event: ReactPointerEvent<SVGSVGElement> | ReactMouseEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height) {
    return null
  }

  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  }
}

function getPdfTextHit(event: ReactMouseEvent<SVGSVGElement>): { text: string; offset: number } | null {
  const doc = event.currentTarget.ownerDocument
  const caretPosition = typeof doc.caretPositionFromPoint === 'function'
    ? doc.caretPositionFromPoint(event.clientX, event.clientY)
    : null
  if (caretPosition?.offsetNode?.nodeType === Node.TEXT_NODE && typeof caretPosition.offset === 'number') {
    const text = caretPosition.offsetNode.textContent ?? ''
    if (text) {
      return { text, offset: clampTextOffset(caretPosition.offset, text) }
    }
  }

  const legacyDoc = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const range = typeof legacyDoc.caretRangeFromPoint === 'function'
    ? legacyDoc.caretRangeFromPoint(event.clientX, event.clientY)
    : null
  if (range?.startContainer.nodeType === Node.TEXT_NODE && typeof range.startOffset === 'number') {
    const text = range.startContainer.textContent ?? ''
    if (text) {
      return { text, offset: clampTextOffset(range.startOffset, text) }
    }
  }

  return null
}

function clampTextOffset(offset: number, text: string): number {
  return Math.max(0, Math.min(text.length, offset))
}

function buildInkAnnotation(page: number, strokes: DraftStroke[]): ProjectCommentPdfAnnotation | null {
  const normalizedStrokes: ProjectCommentPdfStroke[] = strokes
    .map((stroke) => ({
      points: dedupePoints(stroke.points),
    }))
    .filter((stroke) => stroke.points.length >= 2)

  if (normalizedStrokes.length === 0) {
    return null
  }

  const bounds = computeBounds(normalizedStrokes)
  if (!bounds) {
    return null
  }

  return {
    kind: 'ink',
    page,
    color: 'var(--warning)',
    bounds,
    strokes: normalizedStrokes,
  }
}

function dedupePoints(points: Array<{ x: number; y: number }>) {
  return points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || previous.x !== point.x || previous.y !== point.y
  })
}

function computeBounds(strokes: ProjectCommentPdfStroke[]) {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  const padding = 0.01
  const x = clamp(minX - padding)
  const y = clamp(minY - padding)
  const right = clamp(maxX + padding)
  const bottom = clamp(maxY + padding)
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function strokeToPath(stroke: DraftStroke | ProjectCommentPdfStroke, width: number, height: number) {
  return stroke.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * width} ${point.y * height}`).join(' ')
}

function countStrokePoints(strokes: DraftStroke[]) {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0)
}

function clamp(value: number) {
  if (value < 0) {
    return 0
  }

  if (value > 1) {
    return 1
  }

  return value
}
