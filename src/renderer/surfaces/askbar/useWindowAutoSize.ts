/**
 * Sizes the Ask bar window. The study box (route 'prompt') grows and shrinks with its card: it is
 * measured and main is asked for `window.setSize` (width 560, height from 52 up to a cap) when it
 * changes, and again whenever the window comes back (main reopens it 52 tall). The double-tap chat
 * is never sized from here: main opens it at the remembered size and the student resizes it by its
 * edges, so the card simply fills the window. Returns the study box's height cap (0 for the chat),
 * which the card also uses, so a long answer scrolls inside the card instead of being cut off.
 */
import type { DumbledoreApi } from '@shared/ipc'
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { report } from '../overlay/lib/bridge'

export const ASK_WIDTH = 560
export const BAR_HEIGHT = 52
export const MAX_HEIGHT = 600
/** Room kept free on a short screen (main keeps windows 8 pt inside the work area). */
const SCREEN_MARGIN = 16

/** The tallest the bar may grow: MAX_HEIGHT, or less when the screen is short. */
export function heightCap(screenHeight = 0): number {
  if (!(screenHeight > 0)) return MAX_HEIGHT
  return Math.max(BAR_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(screenHeight - SCREEN_MARGIN)))
}

export function clampHeight(measured: number, cap = MAX_HEIGHT): number {
  return Math.max(BAR_HEIGHT, Math.min(cap, Math.ceil(measured)))
}

export function useWindowAutoSize(
  api: DumbledoreApi,
  ref: RefObject<HTMLElement | null>,
  panel = false,
): number {
  const [cap] = useState(() => heightCap(window.screen?.availHeight))
  const last = useRef('')

  useLayoutEffect(() => {
    const el = ref.current
    // The chat's size belongs to main and the student; forget the bar's last size so coming
    // back to the study box asks again.
    if (!el || panel) {
      last.current = ''
      return
    }
    const push = (force: boolean) => {
      const width = ASK_WIDTH
      const height = clampHeight(el.getBoundingClientRect().height, cap)
      const key = `${width}x${height}`
      if (key === last.current && !force) return
      last.current = key
      api
        .invoke('window.setSize', { surface: 'askbar', width, height })
        .catch((e: unknown) => report(e, 'window.setSize'))
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
  }, [api, ref, cap, panel])

  return panel ? 0 : cap
}
