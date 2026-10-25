/**
 * Ask flow (F5) and `/d` instructions: one coach turn on the cheap LLM.
 *
 * The Ask bar (double tap) is a conversation with Dumbledore: it never pastes into the AI chat.
 * Its actions come back as chips the student can press (insert_prompt is dropped there), e.g.
 * adjust_roadmap when they say what a subject should cover. A `/d …` line typed in the AI chat
 * box still acts in place: "I want to understand X" starts a roadmap whose first prompt is pasted,
 * and other actions become toast buttons.
 * Turns live in thread 'ask'; the context is its last 10 messages after the latest "New chat"
 * (`since`), and the reply streams as 'chat.delta' on that thread when `emitDelta` is wired.
 * A topic selected in the Ask bar (`subjectId`) leads the coach context: "Topic: <name>" plus that
 * subject's goal, deadline, open roadmap (active or paused) and step, and struggling concepts.
 * A "Start roadmap" chip for a subject that already has an open roadmap becomes "Open subject"
 * (`chatRoadmapActions`), so the chat never plans a second one.
 *
 * What the student tells Dumbledore is saved into their studying at once (ChatSaves): what they
 * ask or don't get (save_question), facts about a course (update_subject) and notes they ask to
 * keep (add_note), each as a receipt line in the reply with an Undo chip. Feedback the coach
 * recognises (give_feedback) is stored right away and reaches the prompts of its scope.
 *
 * With chat tools wired (and a brain with coachLoop), the double-tap chat runs the tool loop
 * instead of the single coach call: the model reads, writes and acts through the tools
 * (chat-tools/index.ts) until it answers. The reply streams as before; the assistant message
 * carries the turn's chips and one labelled undo_save per receipt (what was done, with Undo), and
 * the web sources as links under the text. The history the next turns send says what was done
 * ("Done: …" lines from those receipts) without showing it twice in the chat. `/d` instructions
 * and a brain without coachLoop keep the single coach call.
 */
import type { Brain, CoachInput } from '@engine/brain-contract'
import type { FeedbackRepo, PerceptionService, Repos } from '@engine/contracts'
import { aiFailureText } from '@shared/ai-errors'
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import type { ChatWriter, FieldSnapshot } from '../chat/chat-writer'
import type { ChatTools, ChatTurnTools } from '../chat-tools'
import { askedToOpen, type StartRoadmapAction } from '../chat-tools/flows'
import { withProgress } from '../chat-tools/progress'
import { sourcesMarkdown } from '../chat-tools/web-search'
import { coachActionLabel } from '../overlay/labels'
import type { ToastSpec } from '../overlay/toasts'
import { keyName } from '../router/hints'
import type { ChatSaves } from './chat-saves'
import { chatRoadmapActions, openRoadmaps, roadmapProgress } from './context'
import type { SessionFlow } from './session-flow'
import type { Thinking } from './thinking'

export const ASK_THREAD = 'ask'
const HISTORY_LIMIT = 10

export interface AskFlowDeps {
  brain: Brain
  repos: Repos
  perception: Pick<PerceptionService, 'aiChat'>
  sessions: Pick<SessionFlow, 'start'> & Partial<Pick<SessionFlow, 'next'>>
  writer: Pick<ChatWriter, 'write'>
  thinking: Thinking
  overlay: { showToast(spec: ToastSpec): string }
  contextText: () => string
  runAction: (action: CoachAction) => Promise<void>
  /** Streams the reply to the windows (thread 'ask'); optional, the result carries it too. */
  emitDelta?: (delta: EventPayload<'chat.delta'>) => void
  /** The tool loop's current step ("Reading your roadmap…") for the Ask bar; optional. */
  emitProgress?: (progress: EventPayload<'chat.progress'>) => void
  /** Feedback store; without it give_feedback is ignored. */
  feedback?: Pick<FeedbackRepo, 'add'>
  /** Saves what the chat hears into the student's studying; without it saves stay chips. */
  saves?: Pick<ChatSaves, 'apply'>
  /** The AI the student studies with (the open chat, else the usual one), for "Open Claude …". */
  assistantName?: () => string | null
  /** Tells the open chat to reload (a message was added after the reply). */
  chatChanged?: () => void
  /** Wait before the one retry of a plan that timed out (tests pass 0). */
  retryAfterMs?: number
  /** The chat tools; with them (and brain.coachLoop) the chat runs the tool loop. */
  chatTools?: Pick<ChatTools, 'turn'>
}

export interface AskOptions {
  /** The field a `/d` line was typed in; writes are skipped if it changed. */
  expect?: FieldSnapshot | null
  /** 'replaceAll' replaces a `/d …` line that is the whole content of the chat box. */
  mode?: 'insert' | 'replaceAll'
  signal?: AbortSignal
  /** ISO time of the Ask bar's last "New chat": older messages are left out of the context. */
  since?: string
  /** The topic selected in the Ask bar: its context leads what the coach sees. */
  subjectId?: string
}

const STRUGGLE_LIMIT = 5

/** Leads the coach context in the Ask bar: a conversation, so nothing is pasted (P10 knows it). */
const CHAT_MODE =
  'Mode: chat (the student is talking with you in your own window; nothing is pasted into their AI chat. What you save here — save_question, update_subject, add_note when they ask to keep something, give_feedback — is saved at once and shown with Undo. Call start_roadmap only when they ask to plan, study or prepare something, never for a single question (answer that); planning then starts at once and step 1 waits for their tap in their AI chat)'

/** "Topic: <name>" and that subject's own context, or null for an unknown subject. */
export function topicContext(
  repos: Pick<Repos, 'subjects' | 'roadmaps' | 'concepts'>,
  subjectId: string,
): string | null {
  const subject = repos.subjects.get(subjectId)
  if (!subject) return null
  const lines = [`Topic: ${subject.name} (the student picked this topic for the question)`]
  if (subject.description.trim()) lines.push(`About: ${subject.description.trim()}`)
  if (subject.goal?.trim()) lines.push(`Goal: ${subject.goal.trim()}`)
  if (subject.deadline) lines.push(`Deadline: ${subject.deadline.slice(0, 10)}`)
  const roadmap = openRoadmaps(repos, subject.id)[0]
  if (roadmap) {
    const current = roadmap.items.find((i) => i.status === 'current')
    const step = current ? `; now: ${current.title}` : ''
    lines.push(`Roadmap (${roadmap.status}): ${roadmap.title} (${roadmapProgress(roadmap)}${step})`)
  }
  const struggling = repos.concepts
    .listBySubject(subject.id)
    .filter((c) => c.status === 'struggling')
    .slice(0, STRUGGLE_LIMIT)
    .map((c) => c.name)
  if (struggling.length) lines.push(`Struggling with: ${struggling.join(', ')}`)
  return lines.join('\n')
}

/**
 * What an earlier message says in the history the model gets: an assistant reply plus what it
 * did ("Done: …" from its receipts, "Waiting for the student's click: …" for its chips), so the
 * next turn knows a roadmap was planned or a note saved. The chat itself shows them as rows.
 */
export function historyContent(message: ChatMessage): string {
  if (message.role !== 'assistant') return message.content
  const done = message.actions.flatMap((a) =>
    a.type === 'undo_save' && a.label ? [`Done: ${a.label}`] : [],
  )
  const offered = message.actions.flatMap((a) =>
    a.type === 'run_tool' ? [`Waiting for the student's click: ${a.label}`] : [],
  )
  return [message.content, ...done, ...offered].filter(Boolean).join('\n')
}

/** Messages created after `since` (epoch ms); all of them when there was no "New chat". */
export function afterReset(messages: ChatMessage[], since: number | null): ChatMessage[] {
  if (since === null) return messages
  return messages.filter((m) => Date.parse(m.createdAt) > since)
}

export class AskFlow {
  /** Latest "New chat" seen from the Ask bar; `/d` turns share the thread, so they honour it too. */
  private since: number | null = null
  private seq = 0
  /** The tool-loop turn being answered; a plan's "ready" message waits for its reply. */
  private turn: Promise<void> | null = null

  constructor(private readonly deps: AskFlowDeps) {}

  /**
   * Ask bar (double tap): reply + actions as chips. With chat tools it runs the tool loop
   * (submitWithTools); without, one coach call where nothing is ever pasted.
   */
  async submit(text: string, opts: AskOptions = {}): Promise<AskResult> {
    if (this.deps.chatTools && this.deps.brain.coachLoop) return this.submitWithTools(text, opts)
    this.noteReset(opts.since)
    const { reply, actions } = await this.converse(text, opts.signal, opts.subjectId, CHAT_MODE)
    const applied = this.applyInChat(
      chatRoadmapActions(
        this.deps.repos,
        actions.filter((a) => a.type !== 'insert_prompt'),
      ),
      reply,
    )
    const content = [reply, ...applied.lines].filter(Boolean).join('\n\n')
    this.deps.repos.chat.append({
      thread: ASK_THREAD,
      role: 'assistant',
      content,
      actions: applied.actions,
    })
    return { reply: content, actions: applied.actions, pasted: false }
  }

  /**
   * Saves happen now: each adds a receipt line ("Saved to …") and its Undo chip; feedback is
   * stored, with a "Got it" line when the coach said nothing. Other actions stay chips.
   */
  private applyInChat(
    actions: CoachAction[],
    reply: string,
  ): { actions: CoachAction[]; lines: string[] } {
    const { feedback, saves } = this.deps
    const chips: CoachAction[] = []
    const undos: CoachAction[] = []
    const lines: string[] = []
    for (const action of actions) {
      if (action.type === 'give_feedback') {
        if (feedback && action.text.trim()) {
          feedback.add({ scope: action.scope, subjectId: action.subjectId, text: action.text })
          if (!reply) lines.push('Got it, I’ll keep that in mind from now on.')
        }
        continue
      }
      if (action.type === 'start_roadmap' && this.deps.sessions) {
        lines.push(`Planning a roadmap for “${action.goal}”. I’ll tell you here when it’s ready.`)
        this.plan(action)
        continue
      }
      const receipt = saves?.apply(action)
      if (receipt) {
        if (receipt.line) lines.push(receipt.line)
        if (receipt.undo) undos.push(receipt.undo)
        chips.push(...receipt.more)
      } else if (action.type !== 'add_note' || !saves) {
        chips.push(action)
      }
    }
    return { actions: [...chips, ...undos], lines }
  }

  /**
   * Plans the roadmap the student asked for while they keep talking (the orb shows "Building your
   * roadmap…"), then says in the chat that it is ready and where step 1 is: their next tap in
   * their AI chat. With `startNow` (the student asked to start) and an AI chat open when the plan
   * is ready, step 1 is pasted there instead. Nothing is ever opened. A failure says why and
   * offers to try again.
   */
  plan(action: StartRoadmapAction, opts: { startNow?: boolean } = {}): void {
    const { sessions, repos } = this.deps
    const say = async (content: string, actions: CoachAction[]) => {
      // Never above the reply of the turn that asked for the plan.
      await this.turn
      repos.chat.append({ thread: ASK_THREAD, role: 'assistant', content, actions })
      this.deps.chatChanged?.()
    }
    const plan = () =>
      sessions.start(
        { subjectId: action.subjectId, goal: action.goal, question: null },
        { hold: true },
      )
    // One retry after an AI timeout: the keyless fallback allows two requests a minute, and the
    // chat reply just used one, so a plan right after it often waits its turn.
    plan()
      .catch(async (error: unknown) => {
        const why = error instanceof Error ? error.message : String(error)
        if (!aiFailureText(why)) throw error
        await new Promise((r) => setTimeout(r, this.deps.retryAfterMs ?? 30_000))
        return plan()
      })
      .then(async ({ session }) => {
        if (!session) return say('Your roadmap is ready.', [])
        await this.turn
        const key = keyName(repos.settings.get().shortcut.key)
        const ai = this.deps.assistantName?.()
        const open = opts.startNow ? this.deps.perception.aiChat() : null
        const pasted =
          open && sessions.next
            ? await sessions
                .next()
                .then((r) => (r.write?.ok ? open.assistant : null))
                .catch(() => null)
            : null
        const where = pasted
          ? `Step 1 is in your ${pasted} chat box`
          : ai
            ? `Open ${ai} and tap ${key} for step 1`
            : `In your AI chat, tap ${key} for step 1`
        // An exam date given with the request lands on the subject the planner found or made.
        const fact = action.deadline
          ? this.deps.saves?.apply({
              type: 'update_subject',
              subjectId: session.subjectId,
              goal: null,
              deadline: action.deadline,
              scope: null,
            })
          : null
        await say(
          [
            `Your roadmap is ready: **${session.title}**, ${session.total} steps. ${where}.`,
            fact?.line,
          ]
            .filter(Boolean)
            .join('\n\n'),
          [
            { type: 'open_subject', subjectId: session.subjectId },
            ...(fact?.undo ? [fact.undo] : []),
            ...(pasted
              ? [{ type: 'undo_save' as const, saveId: '', label: `Pasted step 1 into ${pasted}` }]
              : []),
          ],
        )
      })
      .catch((error: unknown) => {
        const raw = error instanceof Error ? error.message : String(error)
        const why = aiFailureText(raw) ?? raw.replace(/^Couldn't build a roadmap:\s*/, '')
        return say(`I couldn’t plan that yet. ${why}`, [action])
      })
  }

  /**
   * The double-tap chat with tools: the model reads, writes and acts in a loop until it answers.
   * Receipts become labelled undo_saves (the UI shows them as lines with Undo), chips stay chips,
   * web sources go under the reply as links. A website opens only when the student's message
   * asked for it (askedToOpen) or later on a chip click.
   */
  private async submitWithTools(text: string, opts: AskOptions): Promise<AskResult> {
    const { repos, brain, chatTools } = this.deps
    if (!chatTools || !brain.coachLoop) throw new Error('Chat tools are not wired.')
    this.noteReset(opts.since)
    const history = afterReset(repos.chat.history(ASK_THREAD, HISTORY_LIMIT), this.since).map(
      (m) => ({ role: m.role, content: historyContent(m) }),
    )
    repos.chat.append({ thread: ASK_THREAD, role: 'user', content: text, actions: [] })
    const topic = opts.subjectId ? topicContext(repos, opts.subjectId) : null
    const context = [topic, this.deps.contextText()].filter(Boolean).join('\n\n')
    const turn = chatTools.turn({ signal: opts.signal, userAskedToOpen: askedToOpen(text) })
    const messageId = `ask_pending_${++this.seq}`
    let answered = () => {}
    const current = new Promise<void>((resolve) => {
      answered = resolve
    })
    this.turn = current
    try {
      return await this.answerWithTools(text, opts, turn, history, context, messageId)
    } finally {
      if (this.turn === current) this.turn = null
      answered()
    }
  }

  private async answerWithTools(
    text: string,
    opts: AskOptions,
    turn: ChatTurnTools,
    history: CoachInput['history'],
    context: string,
    messageId: string,
  ): Promise<AskResult> {
    const { repos, brain, thinking, emitDelta } = this.deps
    let reply = ''
    try {
      await thinking.run('Thinking…', async () => {
        const events = brain.coachLoop?.(
          { profile: repos.profile.get().summary, context, history, message: text },
          withProgress(turn, (label) =>
            this.deps.emitProgress?.({ thread: ASK_THREAD, messageId, label }),
          ),
          { signal: opts.signal },
        )
        if (!events) return
        for await (const event of events) {
          if (event.type === 'text') {
            reply += event.delta
            emitDelta?.({ thread: ASK_THREAD, messageId, delta: event.delta, done: false })
          }
        }
      })
    } finally {
      emitDelta?.({ thread: ASK_THREAD, messageId, delta: '', done: true })
    }
    const content = [reply.trim(), sourcesMarkdown(turn.sources())].filter(Boolean).join('\n\n')
    const actions = turn.actions()
    repos.chat.append({ thread: ASK_THREAD, role: 'assistant', content, actions })
    return { reply: content, actions, pasted: false }
  }

  /** `/d …` turn: a roadmap or prompt the coach proposes is pasted into the chat box at once. */
  private async act(text: string, opts: AskOptions): Promise<AskResult> {
    this.noteReset(opts.since)
    const { reply, actions } = await this.converse(text, opts.signal, opts.subjectId)
    const remaining: CoachAction[] = []
    let pasted = false
    for (const action of actions) {
      const pastable = action.type === 'start_roadmap' || action.type === 'insert_prompt'
      if (!pasted && pastable && !opts.signal?.aborted && this.deps.perception.aiChat()) {
        pasted = await this.paste(action, opts)
        if (!pasted && action.type === 'insert_prompt') remaining.push(action)
      } else {
        remaining.push(action)
      }
    }
    this.deps.repos.chat.append({
      thread: ASK_THREAD,
      role: 'assistant',
      content: reply,
      actions: remaining,
    })
    if (pasted && reply) {
      this.deps.overlay.showToast({
        kind: 'tip',
        purpose: 'instruction-reply',
        title: 'Dumbledore',
        body: reply,
        ttlMs: 12_000,
      })
    }
    return { reply, actions: remaining, pasted }
  }

  /** `/d …` typed in a field: same turn, answered with a toast and action buttons. */
  async instruction(text: string, opts: AskOptions = {}): Promise<AskResult> {
    const result = await this.act(text, opts)
    if (!result.pasted && !opts.signal?.aborted) {
      const runAction = this.deps.runAction
      this.deps.overlay.showToast({
        kind: 'tip',
        purpose: 'instruction-reply',
        title: 'Dumbledore',
        body: result.reply || 'Done.',
        actions: result.actions.slice(0, 3).map((action, i) => ({
          id: `action-${i}`,
          label: coachActionLabel(action),
          primary: i === 0,
          run: () => runAction(action),
        })),
      })
    }
    return result
  }

  private noteReset(since: string | undefined): void {
    const at = since ? Date.parse(since) : Number.NaN
    if (Number.isFinite(at) && (this.since === null || at > this.since)) this.since = at
  }

  private async converse(
    text: string,
    signal?: AbortSignal,
    subjectId?: string,
    mode?: string,
  ): Promise<{ reply: string; actions: CoachAction[] }> {
    const { repos, brain, thinking, emitDelta } = this.deps
    const history = afterReset(repos.chat.history(ASK_THREAD, HISTORY_LIMIT), this.since).map(
      (m) => ({ role: m.role, content: m.content }),
    )
    repos.chat.append({ thread: ASK_THREAD, role: 'user', content: text, actions: [] })
    const topic = subjectId ? topicContext(repos, subjectId) : null
    const context = [mode, topic, this.deps.contextText()].filter(Boolean).join('\n\n')
    const messageId = `ask_pending_${++this.seq}`
    let reply = ''
    const actions: CoachAction[] = []
    try {
      await thinking.run('Thinking…', async () => {
        const events = brain.coach(
          {
            profile: repos.profile.get().summary,
            context,
            history,
            message: text,
          },
          { signal },
        )
        for await (const event of events) {
          if (event.type === 'text') {
            reply += event.delta
            emitDelta?.({ thread: ASK_THREAD, messageId, delta: event.delta, done: false })
          } else if (event.type === 'action') {
            actions.push(event.action)
          }
        }
      })
    } finally {
      emitDelta?.({ thread: ASK_THREAD, messageId, delta: '', done: true })
    }
    return { reply: reply.trim(), actions }
  }

  private async paste(action: CoachAction, opts: AskOptions): Promise<boolean> {
    if (action.type === 'start_roadmap') {
      const result = await this.deps.sessions.start(
        { subjectId: action.subjectId, goal: action.goal, question: null },
        opts,
      )
      return result.write?.ok ?? false
    }
    if (action.type === 'insert_prompt') {
      const out = await this.deps.writer.write({
        text: action.text,
        mode: opts.mode ?? 'insert',
        target: 'chat',
        expect: opts.expect,
        signal: opts.signal,
      })
      return out.ok
    }
    return false
  }
}
