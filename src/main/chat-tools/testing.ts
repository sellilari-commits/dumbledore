/**
 * Test fixtures for the chat tools (tests only; imports vitest): Ilari's world — Statistics with a paused
 * causal-inference roadmap at step 3 of 6, Machine Learning with an active roadmap, an empty
 * Chemistry — on in-memory repos, with the read models the tools need.
 */
import type { Brain, CoachEvent, CoachInput, CoachTools } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { AiChatInfo, ChatContext } from '@engine/contracts'
import { createEngineBus } from '@engine/events'
import { supersedeRoadmap } from '@engine/learning/study/roadmap-history'
import { createQueryService } from '@engine/queries/query-service'
import { createMemoryControl } from '@engine/subjects/memory-control'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Roadmap, RoadmapItem } from '@shared/domain'
import type { MemoryChanged, SessionState, StartSessionInput } from '@shared/state'
import { vi } from 'vitest'
import { AskFlow } from '../flows/ask-flow'
import { ChatSaves } from '../flows/chat-saves'
import { CoachActions } from '../flows/coach-actions'
import { coachContextText, openRoadmaps } from '../flows/context'
import type { SessionFlow } from '../flows/session-flow'
import type { Thinking } from '../flows/thinking'
import { TypedNotes } from '../flows/typed-notes'
import { createChatFlows } from './flows'
import { createChatTools } from './index'
import { UndoLog } from './undo'

export const WORLD_NOW = '2026-10-25T07:20:00.000Z'

export function roadmapItem(
  idx: number,
  title: string,
  status: RoadmapItem['status'],
  kind: RoadmapItem['kind'] = 'learn',
): RoadmapItem {
  const base = { id: `item_${idx}`, idx, title, status }
  return kind === 'learn'
    ? {
        ...base,
        kind,
        objective: `Understand ${title}`,
        concepts: [title],
        move: 'intuition',
        promptDraft: `Explain ${title}`,
        promptSent: null,
      }
    : { ...base, kind, covers: [], probes: [], nQuestions: 3, quizId: null, score: null }
}

export function roadmapOf(
  id: string,
  subjectId: string,
  title: string,
  status: Roadmap['status'],
  items: RoadmapItem[],
  at = WORLD_NOW,
): Roadmap {
  return {
    id,
    subjectId,
    title,
    goal: title,
    startReason: '',
    offerPlacement: false,
    estimatedMinutes: 60,
    status,
    items,
    carry: [],
    nextMilestone: null,
    createdAt: at,
    updatedAt: at,
  }
}

export function chatWorld() {
  const clock = new FakeClock(WORLD_NOW)
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const changes: MemoryChanged[] = []
  bus.on('memory:changed', (e) => changes.push(e))
  const stats = repos.subjects.create({ name: 'Statistics', status: 'active' })
  const ml = repos.subjects.create({ name: 'Machine Learning', status: 'active' })
  const chem = repos.subjects.create({ name: 'Chemistry', status: 'active' })
  const causal = repos.concepts.upsert({ subjectId: stats.id, name: 'Causal Inference' })
  repos.concepts.upsert({ subjectId: stats.id, name: 'Functional Noise Models' })
  repos.concepts.upsert({ subjectId: ml.id, name: 'Neural Networks' })
  repos.roadmaps.save(
    roadmapOf('rdm_causal', stats.id, 'Causal Inference and Functional Noise Models', 'paused', [
      roadmapItem(0, 'Causal Inference vs. Association', 'done'),
      roadmapItem(1, 'Additive vs. General Functional Noise', 'done'),
      roadmapItem(2, 'Checkpoint 1 · 3 questions', 'current', 'checkpoint'),
      roadmapItem(3, 'Heteroskedastic and Post-Nonlinear Models', 'todo'),
      roadmapItem(4, 'Applications in Political Science and Economics', 'todo'),
      roadmapItem(5, 'Checkpoint 2 · 3 questions', 'todo', 'checkpoint'),
    ]),
  )
  repos.roadmaps.save(
    roadmapOf('rdm_nn', ml.id, 'Foundations of Neural Networks', 'active', [
      roadmapItem(0, 'Core Architecture of Neural Networks', 'current'),
      roadmapItem(1, 'Artificial Neurons and Activation Functions', 'todo'),
    ]),
  )
  const queries = createQueryService({ repos, clock, greetingName: 'Ilari' })
  const memory = createMemoryControl(repos)
  return { clock, repos, bus, changes, queries, memory, stats, ml, chem, causal }
}

// ─── The chat, wired as the shell wires it, with a scripted model ─────────────────────────────

/** One scripted model turn: calls the real tools and yields what it says. */
export type ModelTurn = (
  input: CoachInput,
  tools: CoachTools,
) => AsyncGenerator<CoachEvent, void, unknown>

export interface ChatHarnessOptions {
  /** An AI chat is open in front (ChatGPT). */
  aiChat?: boolean
  /** The AI the student usually studies with (from captures); null = unknown. */
  usualAi?: string | null
}

/**
 * AskFlow + CoachActions + the chat tools exactly as shell.ts builds them, on Ilari's world.
 * The brain's coachLoop runs the queued ModelTurns (the "model"), which call the real tools.
 * Planning, pasting and opening are fakes that record what happened.
 */
export function chatHarness(opts: ChatHarnessOptions = {}) {
  const w = chatWorld()
  const { repos, bus, clock } = w
  const state = { aiChat: opts.aiChat ?? false }
  const usualAi = opts.usualAi === undefined ? 'Claude' : opts.usualAi
  const turns: ModelTurn[] = []
  const inputs: CoachInput[] = []
  const brain = {
    coach: () => {
      throw new Error('coach() must not run when the tools are wired')
    },
    coachLoop(input: CoachInput, tools: CoachTools): AsyncIterable<CoachEvent> {
      inputs.push(input)
      const next = turns.shift()
      if (!next) throw new Error('no scripted model turn left')
      return next(input, tools)
    },
  } as unknown as Brain
  const perception = {
    aiChat: (): AiChatInfo | null =>
      state.aiChat
        ? {
            key: 'chatgpt',
            assistant: 'ChatGPT',
            pid: 42,
            bundleId: 'com.google.Chrome',
            url: 'https://chatgpt.com/',
            windowTitle: 'ChatGPT',
          }
        : null,
    chatExcerpt: () => '',
    pageContext: () => 'Page: Causal inference lecture notes',
    now: () => null,
  }
  const writes: string[] = []
  const writer = {
    write: vi.fn(async (req: { text: string }) => {
      writes.push(req.text)
      return { ok: true, method: 'paste' as const, reason: null }
    }),
  }
  const opened: string[] = []
  const openUsualAi = vi.fn(async (text: string) => {
    if (!usualAi) return null
    opened.push(text)
    return { name: usualAi, prefilled: usualAi === 'Claude' }
  })
  const surfaces = {
    isOpen: () => false,
    open: vi.fn(async (_surface: string, _o?: { route?: string }) => undefined),
    close: vi.fn(async () => undefined),
    pressEnter: () => undefined,
  }
  const prompts = {
    improve: vi.fn(async (draft: string, ctx: ChatContext) => ({
      prompt: `Act as a tutor. ${draft} (${ctx.pageContext.split('\n')[0]})`,
      coachTip: 'It gives the AI a role and your context.',
    })),
  }
  const planned: { goal: string; subjectId: string | null; hold: boolean }[] = []
  const sessions = {
    start: vi.fn(async (input: StartSessionInput, o: { hold?: boolean } = {}) => {
      planned.push({ goal: input.goal ?? '', subjectId: input.subjectId, hold: o.hold === true })
      const subject = input.subjectId
        ? repos.subjects.get(input.subjectId)
        : repos.subjects.create({ name: input.goal ?? 'New subject', status: 'active' })
      if (!subject) throw new Error('no subject')
      const existing = openRoadmaps(repos, subject.id)[0]
      const roadmap =
        existing ??
        roadmapOf(`rdm_${subject.id}`, subject.id, `Roadmap: ${input.goal}`, 'active', [
          roadmapItem(0, 'Step one', 'current'),
          roadmapItem(1, 'Step two', 'todo'),
        ])
      if (!existing) repos.roadmaps.save(roadmap)
      const current = roadmap.items.find((i) => i.status === 'current')
      const text = `Prompt for ${current?.title ?? 'the next step'}`
      const write = o.hold || !state.aiChat ? null : await writer.write({ text })
      return {
        session: {
          subjectId: subject.id,
          title: roadmap.title,
          total: roadmap.items.length,
        } as unknown as SessionState,
        instruction: { kind: 'paste' as const, text, coachTip: null, itemId: current?.id ?? '' },
        write,
      }
    }),
    next: vi.fn(async () => {
      const write = await writer.write({ text: 'Prompt for Step one' })
      return { session: null, instruction: { kind: 'wait' as const, reason: '' }, write }
    }),
  }
  const adjusted: string[] = []
  const roadmapAdjust = {
    // As RoadmapAdjust → study.start({ replan }): the shown roadmap goes into the history.
    run: vi.fn(async (action: { subjectId: string; instruction: string }) => {
      adjusted.push(action.instruction)
      const old = openRoadmaps(repos, action.subjectId)[0]
      if (old) {
        supersedeRoadmap(repos, old, {
          at: clock.nowIso(),
          by: null,
          reason: `Replanned: ${action.instruction}`,
        })
      }
      repos.roadmaps.save(
        roadmapOf(`rdm_re_${adjusted.length}`, action.subjectId, 'Replanned roadmap', 'paused', [
          roadmapItem(0, 'Replanned step', 'current'),
        ]),
      )
      return { kind: 'wait', reason: '' }
    }),
  }
  const toasts: unknown[] = []
  const overlay = {
    showToast: (spec: unknown) => {
      toasts.push(spec)
      return 'toast'
    },
    openQuiz: vi.fn(),
  }
  const thinking = { run: <T>(_label: string, fn: () => Promise<T>) => fn() } as unknown as Thinking
  const chatChanged = vi.fn()
  const typedNotes = new TypedNotes({ repos, bus })
  const saves = new ChatSaves({ repos, bus, notes: typedNotes })
  const undo = new UndoLog()
  const logs: string[] = []
  const flows = createChatFlows({
    repos,
    bus,
    nowIso: () => clock.nowIso(),
    undo,
    saves,
    notes: typedNotes,
    run: (action) => actions.run(action),
    plan: (action, o) => ask.plan(action, o),
    prompts,
    perception,
    writer,
    sessions: sessions as unknown as SessionFlow,
    surfaces,
    usualAiName: () => usualAi,
    openUsualAi,
    copy: async () => undefined,
    subjectName: () => 'Statistics',
  })
  const tools = createChatTools({
    repos,
    queries: w.queries,
    memory: w.memory,
    bus,
    undo,
    relink: null,
    nowIso: () => clock.nowIso(),
    perform: flows.perform,
    flows: flows.flows,
    refuse: flows.refuse,
    log: (line) => logs.push(line),
  })
  const actions = new CoachActions({
    sessions: sessions as unknown as SessionFlow,
    quizzes: {
      createExam: vi.fn(async () => ({ id: 'qz_new' })),
      startReview: vi.fn(async () => ({ id: 'qz_rev' })),
    } as never,
    settings: repos.settings,
    bus,
    writer,
    surfaces,
    overlay,
    roadmapAdjust: roadmapAdjust as never,
    notes: typedNotes,
    feedback: repos.feedback,
    saves,
    chatTools: tools,
    undoLog: undo,
    chat: repos.chat,
    chatChanged,
  })
  const ask = new AskFlow({
    brain,
    repos,
    perception,
    sessions: sessions as unknown as SessionFlow,
    writer,
    thinking,
    overlay,
    contextText: () =>
      coachContextText({
        repos,
        queries: w.queries,
        study: { current: () => null },
        perception,
        nowIso: () => clock.nowIso(),
      }),
    runAction: (action) => actions.run(action),
    feedback: repos.feedback,
    saves,
    assistantName: () => perception.aiChat()?.assistant ?? usualAi,
    chatChanged,
    retryAfterMs: 0,
    chatTools: tools,
  })
  /** Queues the model's next turn and sends the student's message. */
  const say = (message: string, model: ModelTurn) => {
    turns.push(model)
    return ask.submit(message)
  }
  const thread = () => repos.chat.history('ask', 50)
  return {
    ...w,
    state,
    ask,
    actions,
    tools,
    flows,
    undo,
    saves,
    say,
    thread,
    inputs,
    writes,
    writer,
    opened,
    openUsualAi,
    surfaces,
    prompts,
    sessions,
    planned,
    adjusted,
    logs,
    chatChanged,
    toasts,
  }
}

/** A tool call result as the model reads it. */
export async function call(
  tools: CoachTools,
  name: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result: Record<string, unknown> }> {
  const out = await tools.run(name, input)
  return { ok: out.ok, result: out.result as Record<string, unknown> }
}

/** The read tool's input with the unused fields null. */
export const readInput = (kind: string, more: Record<string, unknown> = {}) => ({
  kind,
  id: null,
  subjectId: null,
  conceptId: null,
  limit: null,
  ...more,
})

/** act's input: args as a JSON string, run now. */
export const actInput = (name: string, args: Record<string, unknown>, offer = false) => ({
  name,
  args: JSON.stringify(args),
  offer,
})

/** Lets background work (the planner) finish. */
export const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}
