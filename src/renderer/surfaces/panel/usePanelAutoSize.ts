/**
 * Fits the panel window to its card: measures the card and asks main for `window.setSize` (width
 * 380, height between MIN_HEIGHT and the cap) whenever it changes, and again when the window comes
 * back. Past the cap the topic list scrolls inside the card (the card's max-height is the cap).
 */
import { invoke } from '@renderer/lib/api'
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { report } from './panel-actions'

export const PANEL_WIDTH = 380
/** Header plus about three rows. */
export const MIN_HEIGHT = 168
export const MAX_HEIGHT = 560
const SCREEN_MARGIN = 16

export function panelHeightCap(screenHeight = 0): number {
  if (!(screenHeight > 0)) return MAX_HEIGHT
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(screenHeight - SCREEN_MARGIN)))
}

export function clampPanelHeight(measured: number, cap = MAX_HEIGHT): number {
  return Math.max(MIN_HEIGHT, Math.min(cap, Math.ceil(measured)))
}

export function usePanelAutoSize(ref: RefObject<HTMLElement | null>): number {
  const [cap] = useState(() => panelHeightCap(window.screen?.availHeight))
  const last = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const push = (force: boolean) => {
      const height = clampPanelHeight(el.getBoundingClientRect().height, cap)
      if (height === last.current && !force) return
      last.current = height
      invoke('window.setSize', { surface: 'panel', width: PANEL_WIDTH, height }).catch(report)
    }
    const onFocus = () => push(true)
    push(false)
    window.addEventListener('focus', onFocus)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => push(false))
    observer?.observe(el)
    return () => {
      window.removeEventListener('focus', onFocus)
      observer?.disconnect()
    }
  }, [ref, cap])

  return cap
}
