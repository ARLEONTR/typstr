import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './HoverTooltips.module.css'

// One tooltip for the whole app. Icon buttons carry their meaning in `title`
// or `aria-label`, but the browser shows a title only after a long pause
// (sometimes not at all) and never shows an aria-label, so the sidebar icons
// gave no hint of what they do. Any element with a title, and any control
// labelled only for screen readers, now gets a tooltip shortly after the
// pointer rests on it or keyboard focus reaches it.
const LABELLED = [
  '[title]',
  '[data-tooltip]',
  'button[aria-label]',
  'a[aria-label]',
  '[role="button"][aria-label]',
  '[role="tab"][aria-label]',
  '[role="menuitem"][aria-label]',
  'select[aria-label]',
  'summary[aria-label]',
  'input[type="checkbox"][aria-label]',
  'input[type="radio"][aria-label]',
].join(', ')
// The code editor has tooltips of its own.
const SKIP = '.cm-editor, [data-no-tooltip], [role="tooltip"]'
const SHOW_DELAY_MS = 300
// Moving along a row of icons shows the next tooltip at once.
const REOPEN_WINDOW_MS = 500
// While its tooltip is shown, an element's title is parked here so the
// browser does not show its own tooltip on top.
const PARKED_TITLE = 'data-tooltip-title'
const GAP_PX = 8
const EDGE_PX = 6

type Placement = 'right' | 'bottom' | 'top'
type Tip = { text: string; anchor: DOMRect; placement: Placement }

function tooltipTarget(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null
  const element = node.closest(LABELLED)
  if (!element || element.closest(SKIP)) return null
  return element
}

function tooltipText(element: Element): string {
  const text = (
    element.getAttribute('title')
    ?? element.getAttribute(PARKED_TITLE)
    ?? element.getAttribute('data-tooltip')
    ?? element.getAttribute('aria-label')
    ?? ''
  ).trim()
  if (!text) return ''
  // A tooltip that only repeats the visible label adds nothing.
  const visible = (element instanceof HTMLElement ? element.innerText : element.textContent ?? '').replace(/\s+/g, ' ').trim()
  return visible && visible.toLowerCase() === text.toLowerCase() ? '' : text
}

function placementFor(anchor: DOMRect): Placement {
  // Icons in the rails along the left edge get the tooltip beside them.
  if (anchor.left < 80 && anchor.width <= 72) return 'right'
  return anchor.bottom + 40 > window.innerHeight ? 'top' : 'bottom'
}

export function HoverTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let current: Element | null = null
    let showTimer: number | undefined
    let watchTimer: number | undefined
    let shown = false
    let lastHiddenAt = 0

    const unpark = (element: Element | null) => {
      const parked = element?.getAttribute(PARKED_TITLE)
      if (!element || parked == null) return
      element.removeAttribute(PARKED_TITLE)
      // The app may have set a new title meanwhile; keep that one.
      if (!element.hasAttribute('title')) element.setAttribute('title', parked)
    }

    const hide = () => {
      window.clearTimeout(showTimer)
      window.clearInterval(watchTimer)
      unpark(current)
      current = null
      if (shown) lastHiddenAt = performance.now()
      shown = false
      setTip(null)
    }

    const show = (element: Element) => {
      const text = tooltipText(element)
      if (!text) return
      const title = element.getAttribute('title')
      if (title !== null) {
        element.setAttribute(PARKED_TITLE, title)
        element.removeAttribute('title')
      }
      current = element
      const reveal = () => {
        if (current !== element || !element.isConnected) return
        const anchor = element.getBoundingClientRect()
        if (anchor.width === 0 && anchor.height === 0) return
        shown = true
        setTip({ text, anchor, placement: placementFor(anchor) })
        // The element can be removed or re-rendered away while hovered.
        watchTimer = window.setInterval(() => {
          if (!element.isConnected) hide()
        }, 400)
      }
      if (performance.now() - lastHiddenAt < REOPEN_WINDOW_MS) {
        reveal()
      } else {
        showTimer = window.setTimeout(reveal, SHOW_DELAY_MS)
      }
    }

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const element = tooltipTarget(event.target)
      if (element === current) return
      hide()
      if (element) show(element)
    }

    const onPointerOut = (event: PointerEvent) => {
      if (!current) return
      const next = event.relatedTarget
      if (next instanceof Node && current.contains(next)) return
      hide()
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.matches(':focus-visible')) return
      // Not while typing into a text field.
      if (target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)) return
      const element = tooltipTarget(target)
      if (!element || element === current) return
      hide()
      show(element)
    }

    const onFocusOut = (event: FocusEvent) => {
      if (current && event.target instanceof Node && current.contains(event.target)) hide()
    }

    const dismiss = () => {
      if (current) hide()
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
      hide()
    }
  }, [])

  // Place the tooltip next to its element, inside the window.
  useLayoutEffect(() => {
    const node = tipRef.current
    if (!tip || !node) return
    const { anchor, placement } = tip
    const box = node.getBoundingClientRect()
    let left: number
    let top: number
    if (placement === 'right') {
      left = anchor.right + GAP_PX
      top = anchor.top + anchor.height / 2 - box.height / 2
    } else {
      left = anchor.left + anchor.width / 2 - box.width / 2
      top = placement === 'bottom' ? anchor.bottom + GAP_PX : anchor.top - GAP_PX - box.height
    }
    left = Math.max(EDGE_PX, Math.min(left, window.innerWidth - box.width - EDGE_PX))
    top = Math.max(EDGE_PX, Math.min(top, window.innerHeight - box.height - EDGE_PX))
    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
    node.style.visibility = 'visible'
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div ref={tipRef} role="tooltip" className={styles.tooltip} style={{ left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>,
    document.body,
  )
}
