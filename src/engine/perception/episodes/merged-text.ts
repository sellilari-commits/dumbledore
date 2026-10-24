/**
 * Order-preserving merge of scrolled frames into one text without duplicate lines.
 *
 * Every line gets a stable fractional rank, so inserting lines revealed above or between known
 * ones never renumbers the others. The rank of a frame's first line is its viewport top, which
 * lets the episode detect scrolling backwards (re-reading).
 */
import type { TextLine } from '@shared/helper-protocol'
import { lineKey } from './text'

export type Align = TextLine['align']

export interface MergedLine {
  text: string
  key: string
  align: Align
  rank: number
  /** Segment (checkpoint) in which the line was last on screen. */
  segment: number
}

export interface FrameLine {
  text: string
  align: Align
}

export interface MergeResult {
  added: MergedLine[]
  /** Index (in document order) of the frame's first line after merging. */
  topIndex: number | null
  lineCount: number
}

const MIN_GAP = 1e-6

export class MergedText {
  private lines: MergedLine[] = []
  private readonly byKey = new Map<string, MergedLine>()

  get size(): number {
    return this.lines.length
  }

  all(): readonly MergedLine[] {
    return this.lines
  }

  get(key: string): MergedLine | undefined {
    return this.byKey.get(key)
  }

  /** Marks lines as seen in `segment` (used when a checkpoint carries the viewport over). */
  touch(keys: Iterable<string>, segment: number): void {
    for (const k of keys) {
      const line = this.byKey.get(k)
      if (line) line.segment = segment
    }
  }

  addFrame(frame: readonly FrameLine[], segment: number): MergeResult {
    const items: FrameLine[] = []
    const seen = new Set<string>()
    for (const l of frame) {
      const key = lineKey(l.text)
      if (!key || seen.has(key)) continue
      seen.add(key)
      items.push(l)
    }
    if (items.length === 0) return { added: [], topIndex: null, lineCount: 0 }

    const keys = items.map((l) => lineKey(l.text))
    const firstAnchor = keys.findIndex((k) => this.byKey.has(k))
    const added: MergedLine[] = []
    if (firstAnchor === -1) {
      // Nothing known: a fresh page or a jump; append in order.
      added.push(...this.insertRun(items, keys, this.lines.at(-1) ?? null, segment))
    } else {
      const anchor = this.byKey.get(keys[firstAnchor] as string) as MergedLine
      const before = this.lines[this.indexOf(anchor) - 1] ?? null
      added.push(
        ...this.insertRun(items.slice(0, firstAnchor), keys.slice(0, firstAnchor), before, segment),
      )
      let cursor = anchor
      let run: FrameLine[] = []
      let runKeys: string[] = []
      const flush = () => {
        if (run.length === 0) return
        added.push(...this.insertRun(run, runKeys, cursor, segment))
        cursor = this.byKey.get(runKeys.at(-1) as string) ?? cursor
        run = []
        runKeys = []
      }
      for (let i = firstAnchor; i < items.length; i++) {
        const key = keys[i] as string
        const known = this.byKey.get(key)
        if (known) {
          flush()
          cursor = known
        } else {
          run.push(items[i] as FrameLine)
          runKeys.push(key)
        }
      }
      flush()
    }

    for (const k of keys) {
      const line = this.byKey.get(k)
      if (line) line.segment = segment
    }
    return { added, topIndex: this.indexOfKey(keys[0] as string), lineCount: items.length }
  }

  /** Current document-order index of a line, or null when unknown. */
  indexOfKey(key: string | null): number | null {
    const line = key === null ? undefined : this.byKey.get(key)
    return line ? this.indexOf(line) : null
  }

  /** Inserts new lines directly after `after` (null = at the very start). */
  private insertRun(
    run: readonly FrameLine[],
    keys: readonly string[],
    after: MergedLine | null,
    segment: number,
  ): MergedLine[] {
    if (run.length === 0) return []
    let at = after ? this.indexOf(after) + 1 : 0
    let lo = after ? after.rank : (this.lines[0]?.rank ?? 0) - run.length - 1
    let hi = this.lines[at]?.rank ?? lo + run.length + 1
    if ((hi - lo) / (run.length + 1) < MIN_GAP) {
      this.renumber()
      at = after ? this.indexOf(after) + 1 : 0
      lo = after ? after.rank : -run.length - 1
      hi = this.lines[at]?.rank ?? lo + run.length + 1
    }
    const step = (hi - lo) / (run.length + 1)
    const fresh: MergedLine[] = run.map((l, i) => ({
      text: l.text,
      key: keys[i] as string,
      align: l.align,
      rank: lo + step * (i + 1),
      segment,
    }))
    this.lines.splice(at, 0, ...fresh)
    for (const line of fresh) this.byKey.set(line.key, line)
    return fresh
  }

  private renumber(): void {
    this.lines.forEach((line, i) => {
      line.rank = i * 1024
    })
  }

  /** Binary search by rank. */
  private indexOf(line: MergedLine): number {
    let lo = 0
    let hi = this.lines.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = (this.lines[mid] as MergedLine).rank
      if (r === line.rank) return mid
      if (r < line.rank) lo = mid + 1
      else hi = mid - 1
    }
    return this.lines.indexOf(line)
  }
}
