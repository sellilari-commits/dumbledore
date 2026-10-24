/** Small types shared inside the perception module. */
import type { TextLine } from '@shared/helper-protocol'

/** What perception knows about a window, with or without its text. */
export interface WindowLike {
  pid: number
  bundleId: string
  appName: string
  windowId: number | null
  title: string | null
  url: string | null
  lines?: readonly Pick<TextLine, 'text' | 'align'>[]
}

/** Stable identity of a window across frames. */
export function windowKey(w: Pick<WindowLike, 'bundleId' | 'windowId' | 'pid'>): string {
  return `${w.bundleId}#${w.windowId ?? `pid${w.pid}`}`
}

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
