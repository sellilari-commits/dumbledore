/**
 * Outline (right ⌥ on a page being read, or "Outline it" on the orb's offer): Dumbledore marks
 * what the student needs to read on the PDF or article in front of them, for the subject the
 * page belongs to.
 *
 *   1. the front window's lines with their screen boxes (Accessibility or OCR),
 *   2. the page's subject (what perception linked it to, else the subject studied last),
 *   3. P15 with the subject's goal, gaps, mastered concepts and open questions → line ranges,
 *   4. ranges → one rectangle each (the union of their line boxes) → the overlay draws them,
 *   5. every "read" passage is saved to the subject as a highlight note, so Memory, roadmaps
 *      and exams know what the student was pointed to.
 */
import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { Concept, Id } from '@shared/domain'
import type { Rect } from '@shared/geometry'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineMark, OutlineOverlay } from '@shared/state'

/** A page needs this many positioned lines to be worth outlining. */
export const MIN_LINES = 6

export type OutlineResult =
  | { kind: 'shown'; read: number; marks: number; subjectId: Id }
  | { kind: 'unreadable' }
  | { kind: 'noSubject' }
  | { kind: 'nothing'; subjectId: Id }

export interface OutlineFlowDeps {
  repos: Repos
  /** The front window with line boxes in global screen points, or null. */
  frontWindow: () => PerceivedWindow | null
  /** The subject this page belongs to (perception's link, else the last one studied). */
  subjectFor: (window: PerceivedWindow) => Id | null
  /** P15 (Brain.outline once wired). */
  outline: (input: OutlineInput, opts?: { signal?: AbortSignal }) => Promise<OutlineOutput>
  /** Shows the marks (null clears them). */
  show: (outline: OutlineOverlay | null) => void
  /** Tells the windows that this subject's memory changed. */
  changed: (subjectId: Id) => void
}

/** Struggling first, then concepts still under half way: what the page should help with. */
function gaps(concepts: readonly Concept[]): OutlineInput['gaps'] {
  const struggling = concepts
    .filter((c) => c.status === 'struggling')
    .sort((a, b) => b.struggleCount - a.struggleCount)
  const weak = concepts.filter((c) => c.status === 'learning' && c.mastery < 0.5)
  return [...struggling, ...weak].slice(0, 12).map((c) => ({
    name: c.name,
    why:
      c.struggleCount > 0 ? `missed ${c.struggleCount}×` : `${Math.round(c.mastery * 100)}% there`,
  }))
}

/** The smallest rectangle around every box. */
export function union(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

export class OutlineFlow {
  constructor(private readonly deps: OutlineFlowDeps) {}

  clear(): void {
    this.deps.show(null)
  }

  async run(signal?: AbortSignal): Promise<OutlineResult> {
    const { repos } = this.deps
    const win = this.deps.frontWindow()
    const lines = (win?.lines ?? []).filter(
      (l): l is typeof l & { box: Rect } => l.box !== null && l.text.trim().length > 0,
    )
    if (!win || lines.length < MIN_LINES) return { kind: 'unreadable' }
    const subjectId = this.deps.subjectFor(win)
    const subject = subjectId ? repos.subjects.get(subjectId) : null
    if (!subject) return { kind: 'noSubject' }

    const concepts = repos.concepts.listBySubject(subject.id)
    const input: OutlineInput = {
      subject: { name: subject.name, goal: subject.goal },
      page: { title: win.title, app: win.appName },
      gaps: gaps(concepts),
      known: concepts
        .filter((c) => c.status === 'mastered')
        .map((c) => c.name)
        .slice(0, 20),
      openQuestions: repos.encounters.openQuestions(subject.id, 8),
      lines: lines.map((l, i) => ({ i, text: l.text })),
      language: repos.profile.get().promptLanguage,
    }
    const out = await this.deps.outline(input, { signal })
    if (signal?.aborted) return { kind: 'nothing', subjectId: subject.id }

    const marks: OutlineMark[] = []
    for (const r of out.ranges) {
      const rect = union(lines.slice(r.from, r.to + 1).map((l) => l.box))
      if (rect) marks.push({ rect, verdict: r.verdict, why: r.why })
    }
    if (marks.length === 0) return { kind: 'nothing', subjectId: subject.id }
    this.deps.show({
      windowId: win.windowId,
      title: win.title,
      subjectName: subject.name,
      summary: out.summary,
      marks,
    })

    const reads = out.ranges.filter((r) => r.verdict === 'read')
    for (const r of reads) {
      const text = lines
        .slice(r.from, r.to + 1)
        .map((l) => l.text.trim())
        .join(' ')
      repos.notes.add({
        subjectId: subject.id,
        conceptId: null,
        encounterId: null,
        kind: 'highlight',
        text,
        keywords: [r.why],
        source: { app: win.appName, bundleId: win.bundleId, url: win.url, title: win.title },
      })
    }
    if (reads.length > 0) this.deps.changed(subject.id)
    return { kind: 'shown', read: reads.length, marks: marks.length, subjectId: subject.id }
  }
}
