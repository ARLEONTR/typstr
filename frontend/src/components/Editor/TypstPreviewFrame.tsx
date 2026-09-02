import { useEffect, useRef, useState } from 'react'
import { buildWsUrl } from '../../api/client'
import styles from './SvgPreview.module.css'

export interface TinymistJumpEvent {
  event: string
  filepath: string
  start: [number, number] | number   // [line, character] 0-based from tinymist
  end: [number, number] | number
}

export interface TinymistContextMenuEvent {
  selectedText: string
  /** Coordinates in the parent viewport */
  x: number
  y: number
}

interface Props {
  src: string
  entryAbsPath?: string | null
  onSessionLost?: () => void
  onJump?: (jump: TinymistJumpEvent) => void
  onContextMenu?: (event: TinymistContextMenuEvent) => void
  cursorPosition?: { line: number; character: number } | null
}

export default function TypstPreviewFrame({ src, entryAbsPath, onSessionLost, onJump, onContextMenu, cursorPosition }: Props) {
  const [isFrameLoaded, setIsFrameLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const controlWsRef = useRef<WebSocket | null>(null)
  const pendingScrollJumpRef = useRef<TinymistJumpEvent | null>(null)
  const scrollJumpRafRef = useRef<number | null>(null)

  useEffect(() => {
    setIsFrameLoaded(false)
  }, [src])

  // Stable callback refs so effects don't need to re-subscribe on every render
  const onSessionLostRef = useRef(onSessionLost)
  onSessionLostRef.current = onSessionLost
  const onJumpRef = useRef(onJump)
  onJumpRef.current = onJump
  const onContextMenuRef = useRef(onContextMenu)
  onContextMenuRef.current = onContextMenu

  // session-lost + context-menu messages come from the data-plane iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin && event.origin !== window.location.origin) {
        return
      }
      if (event.data?.type === 'typstr:session-lost') {
        onSessionLostRef.current?.()
      }
      if (event.data?.type === 'typstr:contextmenu') {
        const rect = iframeRef.current?.getBoundingClientRect()
        onContextMenuRef.current?.({
          selectedText: String(event.data.selectedText ?? ''),
          x: (rect?.left ?? 0) + Number(event.data.x ?? 0),
          y: (rect?.top ?? 0) + Number(event.data.y ?? 0),
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Control-plane WebSocket — separate from the data plane that drives iframe rendering.
  // Receives: editorScrollTo / jumpFromPreview  (preview → editor)
  // Sends:    panelScrollTo                     (editor → preview)
  useEffect(() => {
    if (!src) return

    // src may be an absolute URL (http://...) or a root-relative path (/api/...)
    const basePath = src.startsWith('http')
      ? new URL(src).pathname.replace(/\/+$/, '')
      : src.replace(/\/+$/, '')
    // buildWsUrl honors VITE_WS_BASE_URL when set, allowing local dev to send
    // this arbitrary /api WebSocket upgrade directly to the backend.
    const wsUrl = buildWsUrl(`${basePath}/control`)

    let ws: WebSocket | null = null
    let destroyed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0

    const flushPendingScrollJump = () => {
      scrollJumpRafRef.current = null
      const pendingJump = pendingScrollJumpRef.current
      pendingScrollJumpRef.current = null
      if (pendingJump) {
        onJumpRef.current?.(pendingJump)
      }
    }

    function connect() {
      if (destroyed) return
      ws = new WebSocket(wsUrl)
      controlWsRef.current = ws

      ws.addEventListener('open', () => {
        if (destroyed) {
          ws?.close()
          return
        }
        retryCount = 0
      })

      ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') return
        try {
          const msg = JSON.parse(e.data) as Record<string, unknown>
          if (msg.event === 'editorScrollTo' || msg.event === 'jumpFromPreview') {
            const jump = {
              event: msg.event as string,
              filepath: (msg.filepath ?? '') as string,
              start: msg.start as TinymistJumpEvent['start'],
              end: msg.end as TinymistJumpEvent['end'],
            }
            if (msg.event === 'editorScrollTo') {
              pendingScrollJumpRef.current = jump
              if (scrollJumpRafRef.current === null) {
                scrollJumpRafRef.current = window.requestAnimationFrame(flushPendingScrollJump)
              }
              return
            }
            onJumpRef.current?.(jump)
          }
        } catch { /* ignore malformed frames */ }
      })

      ws.addEventListener('close', () => {
        controlWsRef.current = null
        if (!destroyed) {
          // Exponential backoff: 1s, 2s, 4s, 8s, cap at 16s
          const delay = Math.min(1000 * Math.pow(2, retryCount), 16000)
          retryCount += 1
          retryTimer = setTimeout(connect, delay)
        }
      })

      // error is always followed by close — let close handle retry
      ws.addEventListener('error', () => { })
    }

    connectTimer = setTimeout(connect, 50)

    return () => {
      destroyed = true
      if (connectTimer) clearTimeout(connectTimer)
      if (retryTimer) clearTimeout(retryTimer)
      pendingScrollJumpRef.current = null
      if (scrollJumpRafRef.current !== null) {
        window.cancelAnimationFrame(scrollJumpRafRef.current)
        scrollJumpRafRef.current = null
      }
      controlWsRef.current = null
      if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CLOSING) {
        ws.close()
      }
    }
  }, [src])

  // Send cursor position to tinymist via control plane when the editor cursor moves
  useEffect(() => {
    if (!cursorPosition || !entryAbsPath) return
    const ws = controlWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      event: 'panelScrollTo',
      filepath: entryAbsPath,
      line: cursorPosition.line,
      character: cursorPosition.character,
    }))
  }, [cursorPosition, entryAbsPath])

  return (
    <div className={styles.container}>
      {!isFrameLoaded ? (
        <div className={styles.placeholder}>
          <div className={styles.spinner} />
          <span>Loading Tinymist preview…</span>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title="Typst Preview"
        src={src}
        onLoad={() => setIsFrameLoaded(true)}
        style={{
          flex: 1,
          width: '100%',
          minHeight: 0,
          border: '0',
          display: 'block',
          background: 'var(--editor-bg)',
          visibility: isFrameLoaded ? 'visible' : 'hidden',
        }}
      />
    </div>
  )
}
