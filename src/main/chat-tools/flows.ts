/**
 * What the chat's `act` runs beyond row edits, with receipts and Undo:
 * - perform(action, ctx): the coach flows (CoachAction) the model may run — saves through
 *   ChatSaves (its receipt line and Undo), start_roadmap through the chat's background planner,
 *   adjust_roadmap through RoadmapAdjust (the old version goes to the roadmap history; Undo brings
 *   it back), the rest through CoachActions.
 * - flows: acts by name that are not CoachActions — the old long-press flows from the chat
 *   (write_prompt: the student says what they want, Dumbledore writes the prompt and pastes it;
 *   study_now: a new subject → roadmap → step 1 pasted when ready, or the current step of a
 *   roadmap that exists; open_topic), paste_prompt, and restore_roadmap_version.
 *
 * Websites (Ilari's hard rule): the chat never opens a website or browser tab on its own. A prompt
 * goes into the AI chat that is open; with none open, nothing opens: the result says so and a
 * chip "Open <AI> and paste" waits for the student's click (ctx.confirmed). Only when the
 * student's own message asked to open their AI (ctx.userAskedToOpen) does it open at once.
 * Dumbledore's own pages (a subject page, the panel) may open.
 *
 * A roadmap is never planned twice: start_roadmap refuses a subject (or a goal) that an open
 * roadmap already covers, and says which one to continue.
 */
import type { PerceptionService, PromptService, Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { restoreRoadmapVersion, shownRoadmap } from '@engine/learning/study/roadmap-history'
import type { CoachAction, Roadmap } from '@shared/domain'
import { APP_ROUTES } from '@shared/state'
import { z } from 'zod'
import type { ChatWriter } from '../chat/chat-writer'
import type { ChatSaves } from '../flows/chat-saves'
import { chatContext, openRoadmaps, roadmapProgress } from '../flows/context'
import type { SessionFlow } from '../flows/session-flow'
import type { TypedNotes } from '../flows/typed-notes'
import type { SurfaceControl } from '../platform'
import type { ActFlow } from './act'
import { failure, outcome, type Receipt, short, type ToolCtx, type ToolOutcome } from './types'
import type { UndoLog } from './undo'

export type StartRoadmapAction = Extract<CoachAction, { type: 'start_roadmap' }>

export interface ChatFlowsDeps {
  repos: Repos
  bus: Pick<EngineBus, 'emit'>
  nowIso: () => string
  undo: Pick<UndoLog, 'remember'>
  saves: Pick<ChatSaves, 'apply'>
  notes: Pick<TypedNotes, 'undo'>
  /** CoachActions.run (late-bound): exams, reviews, focus, subject pages, RoadmapAdjust. */
  run: (action: CoachAction) => Promise<void>
  /** The chat's background planner (AskFlow); startNow pastes step 1 when the plan is ready. */
  plan: (action: StartRoadmapAction, opts: { startNow: boolean }) => void
  prompts: Pick<PromptService, 'improve'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  writer: Pick<ChatWriter, 'write'>
  sessions: Pick<SessionFlow, 'start'>
  surfaces: Pick<SurfaceControl, 'open'>
  /** The AI the student studies with when none is open (for "Open Claude and paste"). */
  usualAiName: () => string | null
  /** Copies the prompt and opens the usual AI (prompt.openUsualAi); null = none known. */
  openUsualAi?: (text: string) => Promise<{ name: string; prefilled: boolean } | null>
  /** Puts text on the clipboard (when no AI is known to open). */
  copy?: (text: string) => Promise<void>
  /** The subject studied last, for the prompt writer's context. */
  subjectName?: () => string | null
}

export interface ChatFlows {
  perform(action: CoachAction, ctx: ToolCtx): Promise<ToolOutcome>
  /** Why a coach flow must not run or be offered (a second roadmap); null = fine. */
  refuse(action: CoachAction): string | null
  flows: ActFlow[]
}

// ─── The website rule ─────────────────────────────────────────────────────────────────────────

const OPEN_WORD =
  /\b(open|launch|bring up|pull up|go to|start up|fire up|avaa|avaa?mme|öppna)\b|\bopen it\b/i
const AI_WORD =
  /\b(chat ?gpt|gpt|claude|gemini|perplexity|copilot|mistral|le chat|deepseek|grok|my ai|the ai|an ai|ai chat|browser|tab|website|site)\b/i

/**
 * The student's own message asks to open their AI ("open ChatGPT and paste it", "avaa Claude"):
 * only then may a turn open a website without a click.
 */
export function askedToOpen(message: string): boolean {
  return OPEN_WORD.test(message) && AI_WORD.test(message)
}

// ─── Roadmaps that exist ────────────────────────────────────────────────────────────────────

const STOP = new Set(
  'about again also deeply learn learning master really study studying their there these thing things understand understanding want what with would into from that this have better more some like just need know'.split(
    ' ',
  ),
)

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w))

/**
 * The open roadmap (active or paused) that already covers a goal: every key word of the goal is
 * in the roadmap's title or goal, its subject's name or its topics.
 */
export function coveringRoadmap(repos: Repos, goal: string): Roadmap | null {
  const keys = words(goal)
  if (keys.length === 0) return null
  for (const subject of repos.subjects.list({ status: ['active', 'suggested'] })) {
    for (const roadmap of openRoadmaps(repos, subject.id)) {
      const text = [
        roadmap.title,
        roadmap.goal,
        subject.name,
        ...repos.concepts.listBySubject(subject.id).map((c) => c.name),
      ]
        .join(' ')
        .toLowerCase()
      if (keys.every((k) => text.includes(k))) return roadmap
    }
  }
  return null
}

function roadmapExists(repos: Repos, roadmap: Roadmap): string {
  const subject = repos.subjects.get(roadmap.subjectId)
  return `Not planned: ${subject?.name ?? 'this subject'} already has the ${roadmap.status} roadmap “${roadmap.title}” (${roadmapProgress(roadmap)}, roadmapId ${roadmap.id}). Answer about it and continue it (study_now with its subjectId pastes its current step); to change it use adjust_roadmap. Never plan a second one.`
}

// ─── The flows ──────────────────────────────────────────────────────────────────────────────

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createChatFlows(deps: ChatFlowsDeps): ChatFlows {
  const { repos } = deps
  const subjectName = (id: string | null) => (id ? (repos.subjects.get(id)?.name ?? null) : null)
  const aiLabel = () => deps.perception.aiChat()?.assistant ?? deps.usualAiName() ?? 'your AI'
  const receipt = (line: string, undoId: string | null = null): Receipt => ({ line, undoId })

  /** The chip that pastes `text` on the student's click (it may open their AI then). */
  const pasteChip = (text: string): CoachAction => {
    const usual = deps.usualAiName()
    return {
      type: 'run_tool',
      tool: 'act',
      input: { name: 'paste_prompt', args: JSON.stringify({ text }), offer: false },
      label: usual ? `Open ${usual} and paste` : 'Copy the prompt',
    }
  }

  /**
   * Puts a prompt into the open AI chat; with none open, opens the usual AI only when the student
   * asked (their message or a click), else returns the "Open <AI> and paste" chip.
   */
  async function deliver(text: string, ctx: ToolCtx): Promise<ToolOutcome> {
    const chat = deps.perception.aiChat()
    if (chat) {
      const out = await deps.writer.write({
        text,
        mode: 'insert',
        target: 'chat',
        signal: ctx.signal,
      })
      if (out.ok) {
        return outcome(
          { pasted: true, into: chat.assistant, sent: false },
          { receipts: [receipt(`Pasted into ${chat.assistant}`)] },
        )
      }
      return outcome(
        { pasted: false, why: out.reason, note: 'The prompt is on the clipboard: press ⌘V.' },
        { receipts: [receipt('Copied the prompt: press ⌘V in your AI chat')] },
      )
    }
    if (ctx.confirmed || ctx.userAskedToOpen) {
      const opened = await deps.openUsualAi?.(text)
      if (opened) {
        const line = opened.prefilled
          ? `Opened ${opened.name} with the prompt typed in`
          : `Opened ${opened.name}; the prompt is copied, press ⌘V`
        return outcome(
          { opened: opened.name, prefilled: opened.prefilled },
          {
            receipts: [receipt(line)],
          },
        )
      }
      await deps.copy?.(text)
      return outcome(
        { opened: null, note: 'No usual AI known: the prompt is on the clipboard.' },
        { receipts: [receipt('Copied the prompt: open your AI chat and press ⌘V')] },
      )
    }
    return outcome(
      {
        pasted: false,
        noAiChatOpen: true,
        note: `No AI chat is open and nothing was opened. Tell the student: open their AI chat and ask again, or press the button to open ${aiLabel()} and paste. Never open it yourself.`,
      },
      { chips: [pasteChip(text)] },
    )
  }

  async function writePrompt(request: string, ctx: ToolCtx): Promise<ToolOutcome> {
    const wish = request.trim()
    if (!wish) return failure('Say what the prompt should ask for.')
    const context = chatContext(deps.perception)
    const subject = deps.subjectName?.()
    if (subject) {
      context.pageContext = [`Subject: ${subject}`, context.pageContext]
        .filter((s) => s?.trim())
        .join('\n')
    }
    const written = await deps.prompts.improve(wish, context)
    const prompt = written.prompt.trim()
    if (!prompt) return failure('Could not write a prompt; ask the student to say it differently.')
    const delivered = await deliver(prompt, ctx)
    return {
      ...delivered,
      result: {
        ...(delivered.result as object),
        prompt: short(prompt, 600),
        ...(written.coachTip ? { whyItWorks: written.coachTip } : {}),
      },
    }
  }

  async function studyNow(
    args: { subjectId: string | null; goal: string; deadline: string | null },
    ctx: ToolCtx,
  ): Promise<ToolOutcome> {
    const named = args.subjectId ? repos.subjects.get(args.subjectId) : null
    if (args.subjectId && !named)
      return failure(`No subject with id ${args.subjectId}; read subjects first`)
    const existing = named
      ? (openRoadmaps(repos, named.id)[0] ?? null)
      : coveringRoadmap(repos, args.goal)
    if (existing) {
      // Continue the roadmap there is: its current step goes into the AI chat.
      const chat = deps.perception.aiChat()
      const step = await deps.sessions.start(
        { subjectId: existing.subjectId, goal: null, question: null },
        { hold: !chat, signal: ctx.signal },
      )
      const title = existing.title
      if (step.instruction.kind === 'quiz') {
        return outcome(
          { continued: title, next: 'checkpoint quiz (asked in the overlay)' },
          {
            receipts: [receipt(`Continued “${short(title, 50)}”: checkpoint next`)],
          },
        )
      }
      if (step.instruction.kind !== 'paste') {
        return outcome({ continued: title, next: step.instruction.kind })
      }
      if (chat) {
        return step.write?.ok
          ? outcome(
              { continued: title, pasted: true, into: chat.assistant },
              {
                receipts: [
                  receipt(`Pasted the next step of “${short(title, 50)}” into ${chat.assistant}`),
                ],
              },
            )
          : outcome(
              { continued: title, pasted: false, why: step.write?.reason ?? null },
              { receipts: [receipt('Copied the next step: press ⌘V in your AI chat')] },
            )
      }
      const delivered = await deliver(step.instruction.text, ctx)
      return { ...delivered, result: { continued: title, ...(delivered.result as object) } }
    }
    deps.plan(
      {
        type: 'start_roadmap',
        subjectId: named?.id ?? null,
        goal: args.goal,
        deadline: args.deadline,
      },
      { startNow: true },
    )
    const ai = deps.perception.aiChat()?.assistant
    return outcome(
      {
        planning: args.goal,
        note: ai
          ? `Planning now; step 1 goes into ${ai} when the plan is ready and the chat says so.`
          : 'Planning now; the chat says when it is ready and where step 1 is. No AI chat is open, so nothing will be pasted or opened.',
      },
      { receipts: [receipt(`Planning a roadmap for “${short(args.goal, 60)}”`)] },
    )
  }

  async function adjust(
    action: Extract<CoachAction, { type: 'adjust_roadmap' }>,
  ): Promise<ToolOutcome> {
    const subject = repos.subjects.get(action.subjectId)
    if (!subject) return failure(`No subject with id ${action.subjectId}; read subjects first`)
    const before = shownRoadmap(repos, subject.id)
    const prefs = repos.subjects.studyPreferences(subject.id)
    await deps.run(action)
    const line = `Replanned ${subject.name}'s roadmap: “${short(action.instruction, 60)}”`
    const archived = before && repos.roadmaps.version(before.id) ? before : null
    const undoId = archived
      ? deps.undo.remember(line, () => {
          restoreRoadmapVersion({ repos, bus: deps.bus, clock: deps }, archived.id)
          repos.subjects.setStudyPreferences(subject.id, prefs)
          deps.bus.emit('memory:changed', { scope: 'subjects', ids: [subject.id] })
        })
      : null
    const now = shownRoadmap(repos, subject.id)
    return outcome(
      {
        replanned: subject.name,
        roadmap: now ? { id: now.id, title: now.title, progress: roadmapProgress(now) } : null,
        note: 'The earlier version is kept in the roadmap history. Step 1 waits for the next tap in their AI chat.',
      },
      { receipts: [receipt(line, undoId)] },
    )
  }

  function refuse(action: CoachAction): string | null {
    if (action.type !== 'start_roadmap') return null
    const named = action.subjectId ? repos.subjects.get(action.subjectId) : null
    if (action.subjectId && !named)
      return `No subject with id ${action.subjectId}; read subjects first`
    const existing = named
      ? (openRoadmaps(repos, named.id)[0] ?? null)
      : coveringRoadmap(repos, action.goal)
    return existing ? roadmapExists(repos, existing) : null
  }

  async function perform(action: CoachAction, ctx: ToolCtx): Promise<ToolOutcome> {
    const refused = refuse(action)
    if (refused) return failure(refused)
    switch (action.type) {
      case 'save_question':
      case 'update_subject':
      case 'add_note': {
        const saved = deps.saves.apply(action)
        if (!saved) return failure('Nothing to save.')
        if (!saved.undo && saved.line.startsWith('Not saved')) return failure(saved.line)
        if (!saved.line) return outcome({ unchanged: true, note: 'That was already saved.' })
        let undoId: string | null = null
        if (saved.undo?.type === 'undo_save') undoId = saved.undo.saveId
        else if (saved.undo?.type === 'undo_note') {
          const noteId = saved.undo.noteId
          undoId = deps.undo.remember(saved.line, () => deps.notes.undo(noteId))
        }
        return outcome(
          { saved: saved.line },
          {
            receipts: [receipt(saved.line, undoId)],
            chips: saved.more,
          },
        )
      }
      case 'start_roadmap': {
        deps.plan(action, { startNow: false })
        return outcome(
          {
            planning: action.goal,
            note: 'Planning in the background; the chat says when it is ready. Step 1 waits for their next tap in their AI chat.',
          },
          { receipts: [receipt(`Planning a roadmap for “${short(action.goal, 60)}”`)] },
        )
      }
      case 'adjust_roadmap':
        return adjust(action)
      case 'set_focus': {
        const before = repos.settings.get().focusSubjectId
        await deps.run(action)
        const name = subjectName(action.subjectId)
        const line = action.subjectId ? `Focus set to ${name ?? 'the subject'}` : 'Focus cleared'
        const undoId = deps.undo.remember(line, () =>
          deps.run({ type: 'set_focus', subjectId: before }),
        )
        return outcome({ done: line }, { receipts: [receipt(line, undoId)] })
      }
      case 'create_exam': {
        await deps.run(action)
        const line = `Created a ${action.spec.count}-question exam and opened it`
        return outcome(
          { done: line, note: 'It is generating; it opens in the app.' },
          {
            receipts: [receipt(line)],
          },
        )
      }
      case 'start_review': {
        await deps.run(action)
        const n = action.conceptIds.length
        const line = `Started a review of ${n === 1 ? '1 topic' : `${n} topics`}`
        return outcome({ done: line }, { receipts: [receipt(line)] })
      }
      case 'open_subject': {
        const name = subjectName(action.subjectId)
        if (!name) return failure(`No subject with id ${action.subjectId}; read subjects first`)
        await deps.run(action)
        return outcome({ done: `Opened ${name}` }, { receipts: [receipt(`Opened ${name}`)] })
      }
      case 'insert_prompt':
        return deliver(action.text, ctx)
      default:
        return failure(`${action.type} is not run from the chat.`)
    }
  }

  const flows: ActFlow[] = [
    {
      name: 'write_prompt',
      description:
        'the student says what they want from their AI ("a prompt that explains SN1 with an example"): Dumbledore writes a good prompt from it (with their subject and what is on screen) and pastes it into their open AI chat (never sends). request = their wish in their words. Use it when they want a prompt, not for a roadmap',
      input: z.object({ request: z.string().min(1) }),
      label: () => 'Write the prompt',
      run: (args, ctx) => writePrompt(String(args.request), ctx),
    },
    {
      name: 'paste_prompt',
      description:
        "paste a prompt you wrote yourself into the student's open AI chat (never sends). With no AI chat open nothing opens: the student gets a button",
      input: z.object({ text: z.string().min(1) }),
      label: () => `Open ${aiLabel()} and paste`,
      run: (args, ctx) => deliver(String(args.text), ctx),
    },
    {
      name: 'study_now',
      description:
        'the student wants to start learning something now ("I want to learn X, let\'s start"): plans a roadmap (a new subject when subjectId is null) and pastes step 1 into their open AI chat when ready; for a subject that already has a roadmap it continues it and pastes the current step. Use start_roadmap instead when they only want a plan',
      input: z.object({
        subjectId: z.string().nullable(),
        goal: z.string().min(1),
        deadline: z.string().nullable(),
      }),
      label: (args) => `Start studying: ${short(String(args.goal), 40)}`,
      run: (args, ctx) =>
        studyNow(
          {
            subjectId: (args.subjectId as string | null) ?? null,
            goal: String(args.goal),
            deadline: (args.deadline as string | null) ?? null,
          },
          ctx,
        ),
    },
    {
      name: 'open_topic',
      description:
        "open a topic (conceptId from read/search) on its subject's page in the app, where its notes, sources and roadmap steps are",
      input: z.object({ conceptId: z.string() }),
      label: () => 'Open the topic',
      async run(args) {
        const concept = repos.concepts.get(String(args.conceptId))
        if (!concept) return failure(`No topic with id ${args.conceptId}; read the subject first`)
        const name = subjectName(concept.subjectId) ?? 'its subject'
        await deps.surfaces.open('app', {
          route: APP_ROUTES.subject(concept.subjectId, 'concepts'),
        })
        const line = `Opened ${name} › ${concept.name}`
        return outcome({ done: line }, { receipts: [receipt(line)] })
      },
    },
    {
      name: 'restore_roadmap_version',
      description:
        "bring back an earlier version of a subject's roadmap (versionId = a roadmap id from read roadmap_history); the roadmap shown until now goes into the history, nothing is deleted",
      input: z.object({ versionId: z.string() }),
      label: () => 'Bring back this version',
      run(args) {
        const versionId = String(args.versionId)
        try {
          const { restored, replaced } = restoreRoadmapVersion(
            { repos, bus: deps.bus, clock: deps },
            versionId,
          )
          const line = `Brought back “${short(restored.title, 60)}”`
          const previous = replaced[0]
          const undoId = previous
            ? deps.undo.remember(line, () => {
                restoreRoadmapVersion({ repos, bus: deps.bus, clock: deps }, previous)
              })
            : null
          return outcome(
            {
              restored: {
                id: restored.id,
                title: restored.title,
                progress: roadmapProgress(restored),
              },
              replaced,
            },
            { receipts: [receipt(line, undoId)] },
          )
        } catch (error) {
          return failure(errorText(error))
        }
      },
    },
  ]

  return { perform, refuse, flows }
}
