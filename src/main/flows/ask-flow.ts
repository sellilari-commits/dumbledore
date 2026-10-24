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
 * subject's goal, deadline, roadmap step and struggling concepts.
 *
 * The chat also takes feedback: feedback the coach recognises (give_feedback) is stored right away
 * and reaches the prompts of its scope (brain `feedback`). It takes no notes: a note the coach
 * proposes (add_note) is dropped there.
 */
import type { Brain } from '@engine/brain-contract'
import type { FeedbackRepo, PerceptionService, Repos } from '@engine/contracts'
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import type { ChatWriter, FieldSnapshot } from '../chat/chat-writer'
import { coachActionLabel } from '../overlay/labels'
import type { ToastSpec } from '../overlay/toasts'
import type { SessionFlow } from './session-flow'
import type { Thinking } from './thinking'

export const ASK_THREAD = 'ask'
const HISTORY_LIMIT = 10

export interface AskFlowDeps {
  brain: Brain
  repos: Repos
  perception: Pick<PerceptionService, 'aiChat'>
  sessions: Pick<SessionFlow, 'start'>
  writer: Pick<ChatWriter, 'write'>
  thinking: Thinking
  overlay: { showToast(spec: ToastSpec): string }
  contextText: () => string
  runAction: (action: CoachAction) => Promise<void>
  /** Streams the reply to the windows (thread 'ask'); optional, the result carries it too. */
  emitDelta?: (delta: EventPayload<'chat.delta'>) => void
  /** Feedback store; without it give_feedback is ignored. */
  feedback?: Pick<FeedbackRepo, 'add'>
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
  'Mode: chat (the student is talking with you in your own window; nothing is pasted into their AI chat, and no notes are saved here: never call add_note)'

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
  const roadmap = repos.roadmaps.getActive(subject.id)
  if (roadmap) {
    const done = roadmap.items.filter((i) => i.status === 'done').length
    const current = roadmap.items.find((i) => i.status === 'current')
    const step = current ? `; now: ${current.title}` : ''
    lines.push(`Roadmap: ${roadmap.title} (${done}/${roadmap.items.length} done${step})`)
  }
  const struggling = repos.concepts
    .listBySubject(subject.id)
    .filter((c) => c.status === 'struggling')
    .slice(0, STRUGGLE_LIMIT)
    .map((c) => c.name)
  if (struggling.length) lines.push(`Struggling with: ${struggling.join(', ')}`)
  return lines.join('\n')
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

  constructor(private readonly deps: AskFlowDeps) {}

  /** Ask bar (double tap): reply + actions as chips. Chat only: nothing is ever pasted. */
  async submit(text: string, opts: AskOptions = {}): Promise<AskResult> {
    this.noteReset(opts.since)
    const { reply, actions } = await this.converse(text, opts.signal, opts.subjectId, CHAT_MODE)
    const applied = this.applyInChat(
      actions.filter((a) => a.type !== 'insert_prompt' && a.type !== 'add_note'),
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

  /** Feedback from the coach is stored now, with a "Got it" line when the coach said nothing. */
  private applyInChat(
    actions: CoachAction[],
    reply: string,
  ): { actions: CoachAction[]; lines: string[] } {
    const { feedback } = this.deps
    const out: CoachAction[] = []
    const lines: string[] = []
    for (const action of actions) {
      if (action.type === 'give_feedback') {
        if (feedback && action.text.trim()) {
          feedback.add({ scope: action.scope, subjectId: action.subjectId, text: action.text })
          if (!reply) lines.push('Got it, I’ll keep that in mind from now on.')
        }
      } else {
        out.push(action)
      }
    }
    return { actions: out, lines }
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
