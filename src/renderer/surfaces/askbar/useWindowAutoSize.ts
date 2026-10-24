/**
 * Grows and shrinks the Ask bar window with its content: measures the card and asks main for
 * `window.setSize` (width fixed at 560, height from 52 up to a cap), only when it changes.
 */
import type { DumbledoreApi } from '@shared/ipc'
import { type RefObject, useLayoutEffect, useRef } from 'react'
import { report } from '../overlay/lib/bridge'

export const ASK_WIDTH = 560
export const BAR_HEIGHT = 52
export const MAX_HEIGHT = 560

export function clampHeight(measured: number): number {
  return Math.max(BAR_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(measured)))
}

export function useWindowAutoSize(api: DumbledoreApi, ref: RefObject<HTMLElement | null>): void {
  const last = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const push = () => {
      const height = clampHeight(el.getBoundingClientRect().height)
      if (height === last.current) return
      last.current = height
      api
        .invoke('window.setSize', { surface: 'askbar', width: ASK_WIDTH, height })
        .catch((e: unknown) => report(e, 'window.setSize'))
    }
    push()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(push)
    observer.observe(el)
    return () => observer.disconnect()
  }, [api, ref])
}
