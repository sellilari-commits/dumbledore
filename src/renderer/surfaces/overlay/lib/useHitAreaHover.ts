/**
 * Click-through support. The overlay window ignores the mouse except over hit areas (elements
 * marked `data-hit`). Main forwards pointer moves to the page; this hook reports when the pointer
 * enters or leaves the union of hit areas as {type:'hover', inside}, and only on changes.
 *
 * One document-level listener (instead of per-element enter/leave) avoids a false "outside"
 * flicker when the pointer crosses from one hit area into a touching one. Whenever elements are
 * added or removed, the last pointer position is re-tested, so a shape that disappears under a
 * still pointer (a dismissed toast, a closed quiz) hands the clicks back to the app below.
 */
import type { OverlayAction } from '@shared/state'
import { useEffect, useRef } from 'react'

export const HIT_SELECTOR = '[data-hit]'

export function isHitTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(HIT_SELECTOR) !== null
}

export function useHitAreaHover(send: (action: OverlayAction) => void): void {
  const sendRef = useRef(send)
  sendRef.current = send

  useEffect(() => {
    let inside = false
    let last: { x: number; y: number } | null = null
    const set = (next: boolean) => {
      if (next === inside) return
      inside = next
      sendRef.current({ type: 'hover', inside: next })
    }
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY }
      set(isHitTarget(e.target))
    }
    const onLeave = () => {
      last = null
      set(false)
    }
    const recheck = () => {
      if (!last || typeof document.elementFromPoint !== 'function') return
      set(isHitTarget(document.elementFromPoint(last.x, last.y)))
    }
    const observer = new MutationObserver(recheck)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerover', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerover', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (inside) sendRef.current({ type: 'hover', inside: false })
    }
  }, [])
}
