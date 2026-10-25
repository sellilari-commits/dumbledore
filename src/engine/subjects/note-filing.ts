/**
 * Note filing: notes and highlights saved without a topic go into the best existing topic of the
 * best subject on their own, so the Memory page's "Loose notes" don't wait for the student's
 * "File to…". One cheap LLM call (P17) per batch of notes, judged from the note text and its page.
 *
 * Which notes: active notes with no concept that are loose (no subject) or sit unplaced in an
 * active subject. A note the student filed or moved by hand is pinned (memory-control fileNote)
 * and never auto-moved; a pinned loose note (typed or edited, never filed) can still be filed.
 * When nothing fits, a note stays where it is. Filing only: nothing is deleted, reworded,
 * merged or created.
 *
 * When: a few seconds after any 'memory:changed' (so notes that arrive together go in one call),
 * and once in the background shortly after startup, which also files the notes that were loose
 * before this existed. Settings.notesFiledThrough records how far it got (the newest `updatedAt`
 * offered to the model), so each note is offered once per change and a restart doesn't ask again;
 * a failed call leaves it and waits before trying again.
 */
import type { Concept, Id, Note, Subject } from '@shared/domain'
import type { Brain, FileNotesInput } from '../brain-contract'
import type { Cancel, Clock } from '../clock'
import type { Repos } from '../contracts'
import type { EngineBus } from '../events'
import { sourceLabel } from '../memory/sources'
import { conceptTree } from '../perception/extraction/worker'

export interface NoteFilingOptions {
  /** Wait after a memory change, so notes saved together are filed in one call. */
  debounceMs: number
  /** The background pass after startup. */
  startupDelayMs: number
  /** Notes per call. */
  batchSize: number
  /** Concepts listed per subject, and per call. */
  maxSubjectConcepts: number
  maxConcepts: number
  retryAfterMs: number
  timeoutMs: number
}

export const NOTE_FILING_DEFAULTS: NoteFilingOptions = {
  debounceMs: 3_000,
  startupDelayMs: 20_000,
  batchSize: 40,
  maxSubjectConcepts: 60,
  maxConcepts: 150,
  retryAfterMs: 30 * 60_000,
  timeoutMs: 45_000,
}

export interface NoteFilingDeps {
  repos: Repos
  brain: Pick<Brain, 'fileNotes'>
  bus: EngineBus
  clock: Clock
  log?: (message: string, error?: unknown) => void
  options?: Partial<NoteFilingOptions>
}

export interface NoteFilingReport {
  offered: number
  filed: number
}

export interface NoteFilingService {
  start(): void
  stop(): void
  /** Files every waiting note now (no debounce); resolves when done. Null when it couldn't run. */
  runNow(): Promise<NoteFilingReport | null>
}

/** May the filer move this note? No concept yet, and not placed by the student's hand. */
export const fileable = (note: Note): boolean =>
  note.status === 'active' && note.conceptId === null && (note.subjectId === null || !note.pinned)

/** Notes waiting for the filer, oldest change first. */
export function waitingNotes(repos: Repos, subjects: readonly Subject[], since: string | null) {
  const active = new Set(subjects.map((s) => s.id))
  return repos.notes
    .list({})
    .filter(
      (n) =>
        fileable(n) &&
        (n.subjectId === null || active.has(n.subjectId)) &&
        (since === null || n.updatedAt > since),
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

export function createNoteFiling(deps: NoteFilingDeps): NoteFilingService {
  const opts = { ...NOTE_FILING_DEFAULTS, ...deps.options }
  const { repos, clock, bus } = deps
  const log = deps.log ?? (() => {})
  const offs: (() => void)[] = []
  let timer: Cancel | null = null
  let running: Promise<NoteFilingReport | null> | null = null
  let again = false
  let failedAt: number | null = null

  const buildInput = (notes: readonly Note[], subjects: readonly Subject[]): FileNotesInput => {
    // Subjects the notes already sit in first, so their trees always fit the concept budget.
    const own = new Set(notes.map((n) => n.subjectId).filter(Boolean))
    const ordered = [...subjects].sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)))
    let budget = opts.maxConcepts
    return {
      subjects: ordered.map((s) => {
        const all: Concept[] = repos.concepts.listBySubject(s.id)
        const tree = conceptTree(repos, s.id, all, Math.min(opts.maxSubjectConcepts, budget))
        budget -= tree.length
        return { id: s.id, name: s.name, goal: s.goal || null, concepts: tree }
      }),
      notes: notes.map((n) => ({
        id: n.id,
        text: n.text,
        source: [sourceLabel(n.source), n.source.url].filter(Boolean).join(' · '),
        subjectId: n.subjectId,
      })),
    }
  }

  /** Applies the model's placements after checking each one again; returns the touched subjects. */
  const apply = (
    notes: readonly Note[],
    placements: { noteId: Id; subjectId: Id | null; conceptId: Id | null }[],
  ): { filed: number; subjects: Set<Id>; loose: boolean } => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const touched = new Set<Id>()
    let filed = 0
    let loose = false
    repos.transaction(() => {
      for (const p of placements) {
        const offered = byId.get(p.noteId)
        const note = offered ? repos.notes.get(offered.id) : null
        // Changed meanwhile (filed by hand, edited, deleted): leave it alone.
        if (!note || !fileable(note) || note.updatedAt !== offered?.updatedAt) continue
        const concept = p.conceptId ? repos.concepts.get(p.conceptId) : null
        const subjectId = concept?.subjectId ?? p.subjectId
        if (!subjectId || !repos.subjects.get(subjectId)) continue
        if (p.subjectId && p.subjectId !== subjectId) continue
        if (note.subjectId && note.subjectId !== subjectId) continue
        if (!concept && note.subjectId) continue // already in that subject: nothing changes
        repos.notes.update(note.id, { subjectId, conceptId: concept?.id ?? null })
        if (note.subjectId === null) loose = true
        touched.add(subjectId)
        filed++
      }
    })
    return { filed, subjects: touched, loose }
  }

  const pass = async (): Promise<NoteFilingReport | null> => {
    if (!deps.brain.fileNotes) return null
    const subjects = repos.subjects.list({ status: ['active'] })
    const report: NoteFilingReport = { offered: 0, filed: 0 }
    // No subject yet: nothing to file into, and the notes wait for the first one.
    if (subjects.length === 0) return report
    for (;;) {
      const waiting = waitingNotes(repos, subjects, repos.settings.get().notesFiledThrough)
      if (waiting.length === 0) break
      // Keep notes changed at the same instant in one batch, so the mark never splits them.
      const at = (i: number) => waiting[i]?.updatedAt
      let end = Math.min(opts.batchSize, waiting.length)
      while (end < waiting.length && at(end) === at(end - 1)) end++
      const batch = waiting.slice(0, end)
      const through = at(end - 1) as string
      const out = await deps.brain.fileNotes(buildInput(batch, subjects), {
        timeoutMs: opts.timeoutMs,
      })
      const done = apply(batch, out.placements)
      report.filed += done.filed
      if (done.subjects.size > 0) {
        bus.emit('memory:changed', { scope: 'subjects', ids: [...done.subjects] })
        if (done.loose) bus.emit('memory:changed', { scope: 'inbox', ids: [] })
      }
      report.offered += batch.length
      repos.settings.update({ notesFiledThrough: through })
    }
    if (report.offered > 0) log(`[note-filing] filed ${report.filed} of ${report.offered} notes`)
    return report
  }

  const runNow = (): Promise<NoteFilingReport | null> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        const report = await pass()
        failedAt = null
        return report
      } catch (error) {
        failedAt = clock.now()
        log('[note-filing] failed', error)
        return null
      }
    })().finally(() => {
      running = null
      if (again) {
        again = false
        schedule(opts.debounceMs)
      }
    })
    return running
  }

  const schedule = (ms: number) => {
    if (offs.length === 0) return
    if (failedAt !== null && clock.now() - failedAt < opts.retryAfterMs) return
    timer?.()
    timer = clock.setTimeout(() => {
      timer = null
      void runNow()
    }, ms)
  }

  return {
    start() {
      if (offs.length > 0) return
      offs.push(bus.on('memory:changed', () => schedule(opts.debounceMs)))
      schedule(opts.startupDelayMs)
    },
    stop() {
      for (const off of offs.splice(0)) off()
      timer?.()
      timer = null
    },
    runNow,
  }
}
