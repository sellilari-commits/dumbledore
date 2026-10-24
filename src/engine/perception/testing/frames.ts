/** Builders for hand-written frames and perceive batches in perception tests. */
import type { PerceivedWindow, TextLine } from '@shared/helper-protocol'
import type { PerceiveBatch } from '../scheduler'

export type LineSpec = string | [text: string, align: TextLine['align']]

export interface WindowSpec {
  pid?: number
  bundleId?: string
  appName?: string
  windowId?: number | null
  title?: string | null
  url?: string | null
  source?: 'ax' | 'ocr'
  lines?: LineSpec[]
  changed?: boolean
}

export function win(spec: WindowSpec): PerceivedWindow {
  const lines = (spec.lines ?? []).map(
    (l): TextLine =>
      typeof l === 'string'
        ? { text: l, conf: 1, box: null, align: 'left' }
        : { text: l[0], conf: 1, box: null, align: l[1] },
  )
  return {
    pid: spec.pid ?? 100,
    bundleId: spec.bundleId ?? 'com.google.Chrome',
    appName: spec.appName ?? 'Google Chrome',
    windowId: spec.windowId === undefined ? 1 : spec.windowId,
    title: spec.title === undefined ? 'Page' : spec.title,
    url: spec.url === undefined ? 'https://example.org/page' : spec.url,
    frame: null,
    source: spec.source ?? 'ax',
    changed: spec.changed ?? lines.length > 0,
    contentHash: 'h',
    lines,
    capturedAt: new Date(0).toISOString(),
  }
}

export function batch(
  atMs: number,
  front: PerceivedWindow | null,
  visible: PerceivedWindow[] | null = null,
  idleSeconds = 0,
): PerceiveBatch {
  return { at: atMs, idleSeconds, frontmost: null, frontBlocked: null, front, visible }
}

/** n numbered sentences, long enough to read as prose. */
export function prose(prefix: string, from: number, to: number): string[] {
  const out: string[] = []
  for (let i = from; i <= to; i++) {
    out.push(`${prefix} sentence ${i} explains one more idea about the topic in plain words.`)
  }
  return out
}
