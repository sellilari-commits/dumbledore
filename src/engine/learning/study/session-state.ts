/**
 * The study session as the shell sees it (SessionState): phase, position, and what the side
 * button does next. Built from the stored roadmap plus a little in-memory meta (planning, paused,
 * error, assistant), so it can be rebuilt after a restart.
 */
import type { Id, Roadmap, Subject } from '@shared/domain'
import type { SessionState, StepInstruction } from '@shared/state'
import type { EngineBus } from '../../events'
import { currentIndex, isDelivered, isLearn, nextOpenItem } from './roadmap-ops'

export type PhaseOverride = 'planning' | 'paused' | 'error' | null

export interface SessionMeta {
  roadmapId: Id
  subjectId: Id
  /** null = derive from the roadmap (step / checkpoint / complete). */
  phase: PhaseOverride
  error: string | null
  assistant: string | null
  /** What is being planned while phase is 'planning'. */
  planningGoal: string | null
}

/** Raised for failures the shell should show (the session state already reflects them). */
export class StudyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StudyError'
  }
}

export const waitFor = (reason: string): StepInstruction => ({ kind: 'wait', reason })

export function metaFor(
  roadmap: Pick<Roadmap, 'id' | 'subjectId'>,
  assistant: string | null,
): SessionMeta {
  return {
    roadmapId: roadmap.id,
    subjectId: roadmap.subjectId,
    phase: null,
    error: null,
    assistant,
    planningGoal: null,
  }
}

const BUSY = { start: 'Building your roadmap…', next: 'Still preparing the last step…' } as const
export type BusyKind = keyof typeof BUSY

/**
 * One operation at a time: a second start/next while one runs gets a 'wait'. end() cancels, and
 * a plan that finishes after a cancel is discarded (its epoch is stale).
 */
export class SessionGate {
  private busy: { kind: BusyKind; seq: number } | null = null
  private seq = 0
  private epochValue = 0

  get epoch(): number {
    return this.epochValue
  }

  /** The 'wait' to hand out while busy, else null. */
  waiting(): StepInstruction | null {
    return this.busy ? waitFor(BUSY[this.busy.kind]) : null
  }

  begin(kind: BusyKind): number {
    const seq = ++this.seq
    this.busy = { kind, seq }
    return seq
  }

  finish(seq: number): void {
    if (this.busy?.seq === seq) this.busy = null
  }

  cancel(): void {
    this.epochValue++
    this.busy = null
  }
}

export const planningWait = (): StepInstruction => waitFor(BUSY.start)

type NextAction = SessionState['nextAction']

function nextActionFor(phase: SessionState['phase'], roadmap: Roadmap, idx: number): NextAction {
  const item = roadmap.items[idx]
  if (phase === 'planning' || phase === 'paused' || phase === 'complete' || !item) return 'none'
  if (item.kind === 'checkpoint') return 'open_quiz'
  if (!isDelivered(item)) return 'paste_next'
  const following = nextOpenItem(roadmap, idx)
  if (!following) return 'finish'
  return isLearn(following) ? 'paste_next' : 'open_quiz'
}

export function planningState(meta: SessionMeta, subject: Subject | null): SessionState {
  return {
    roadmapId: meta.roadmapId,
    subjectId: meta.subjectId,
    subjectName: subject?.name ?? '',
    subjectEmoji: subject?.emoji ?? '📘',
    title: meta.planningGoal ?? subject?.name ?? '',
    phase: 'planning',
    index: 0,
    total: 0,
    items: [],
    nextAction: 'none',
    assistant: meta.assistant,
    startReason: '',
    offerPlacement: false,
    error: null,
  }
}

export function roadmapState(
  meta: SessionMeta,
  roadmap: Roadmap,
  subject: Subject | null,
): SessionState {
  const idx = currentIndex(roadmap)
  const complete = roadmap.status === 'done' || idx < 0
  const item = roadmap.items[idx]
  const derived: SessionState['phase'] = complete
    ? 'complete'
    : item?.kind === 'checkpoint'
      ? 'checkpoint'
      : 'step'
  const phase: SessionState['phase'] = complete ? 'complete' : (meta.phase ?? derived)
  return {
    roadmapId: roadmap.id,
    subjectId: roadmap.subjectId,
    subjectName: subject?.name ?? '',
    subjectEmoji: subject?.emoji ?? '📘',
    title: roadmap.title,
    phase,
    index: complete ? Math.max(0, roadmap.items.length - 1) : idx,
    total: roadmap.items.length,
    items: roadmap.items,
    nextAction: nextActionFor(phase, roadmap, idx),
    assistant: meta.assistant,
    startReason: roadmap.startReason,
    offerPlacement: roadmap.offerPlacement,
    error: phase === 'error' ? meta.error : null,
  }
}

type Listener = (session: SessionState | null) => void

/** onChange subscribers plus the bus event, fed the same SessionState. */
export class SessionListeners {
  private readonly listeners = new Set<Listener>()

  add(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(bus: EngineBus, session: SessionState | null): void {
    bus.emit('session:changed', { session })
    for (const listener of [...this.listeners]) {
      try {
        listener(session)
      } catch (error) {
        console.error('[study] session listener failed', error)
      }
    }
  }
}
