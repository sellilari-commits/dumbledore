/**
 * Pointer gestures for the orb and the side-stack squares, Goldfish-style:
 * click · press ≥ 500 ms (long press) · drag past a 4 px threshold (only when `onDrag` is given)
 * · right-click. Uses pointer capture so a drag keeps tracking outside the element. Drag updates
 * go out throttled (~30 Hz); the final position is always sent with done=true.
 */
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export const LONG_PRESS_MS = 500
export const DRAG_THRESHOLD = 4
const DRAG_SEND_MS = 33

export interface Point {
  x: number
  y: number
}

export interface GestureHandlers {
  onClick: () => void
  onLongPress: () => void
  onContextMenu?: () => void
  /** Enables dragging. Receives the dragged element's new centre. */
  onDrag?: (p: Point, done: boolean) => void
}

interface Press {
  id: number
  startX: number
  startY: number
  origin: Point
  dragging: boolean
  long: boolean
  timer: number
  lastSent: number
  last: Point
}

export interface Gesture {
  /** Centre while dragging, else null. */
  dragPos: Point | null
  pressed: boolean
  bind: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void
  }
}

export function usePointerGesture(origin: Point, handlers: GestureHandlers): Gesture {
  const press = useRef<Press | null>(null)
  const h = useRef(handlers)
  h.current = handlers
  const originRef = useRef(origin)
  originRef.current = origin
  const [dragPos, setDragPos] = useState<Point | null>(null)
  const [pressed, setPressed] = useState(false)

  // Unmounted mid-gesture (e.g. the orb moved to another display): never leave main mid-drag.
  useEffect(
    () => () => {
      const p = press.current
      if (!p) return
      window.clearTimeout(p.timer)
      if (p.dragging) h.current.onDrag?.(p.last, true)
    },
    [],
  )

  const end = useCallback((e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    window.clearTimeout(p.timer)
    press.current = null
    setPressed(false)
    if (p.dragging) {
      setDragPos(null)
      h.current.onDrag?.(p.last, true)
    } else if (!p.long && !cancelled) {
      h.current.onClick()
    }
  }, [])

  const bind: Gesture['bind'] = {
    onPointerDown: (e) => {
      if (e.button !== 0 || press.current) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const start = { ...originRef.current }
      press.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origin: start,
        dragging: false,
        long: false,
        lastSent: 0,
        last: start,
        timer: window.setTimeout(() => {
          const p = press.current
          if (!p || p.dragging) return
          p.long = true
          setPressed(false)
          h.current.onLongPress()
        }, LONG_PRESS_MS),
      }
      setPressed(true)
    },
    onPointerMove: (e) => {
      const p = press.current
      if (!p || p.id !== e.pointerId) return
      const dx = e.clientX - p.startX
      const dy = e.clientY - p.startY
      if (!p.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (p.long || !h.current.onDrag) {
          // Moving off a press cancels the click, like a native button.
          window.clearTimeout(p.timer)
          p.long = true
          setPressed(false)
          return
        }
        p.dragging = true
        window.clearTimeout(p.timer)
        setPressed(false)
      }
      p.last = { x: p.origin.x + dx, y: p.origin.y + dy }
      setDragPos(p.last)
      const now = performance.now()
      if (now - p.lastSent >= DRAG_SEND_MS) {
        p.lastSent = now
        h.current.onDrag?.(p.last, false)
      }
    },
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
    onContextMenu: (e) => {
      e.preventDefault()
      h.current.onContextMenu?.()
    },
  }

  return { dragPos, pressed, bind }
}
