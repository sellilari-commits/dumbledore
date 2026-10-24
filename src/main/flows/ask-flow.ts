/**
 * Ask flow (F5) and `/d` instructions: one coach turn on the cheap LLM. "I want to understand X"
 * comes back as a start_roadmap action, which runs at once when an AI chat is open (the first
 * prompt is pasted); other actions are returned as chips (ask bar) or toast buttons (`/d`).
 */
import type { Brain } from '@engine/brain-contract'
import type { PerceptionService, Repos } from '@engine/contracts'
import type { CoachAction } from '@shared/domain'
import type { AskResult } from '@shared/state'
import type { ChatWriter, FieldSnapshot } from '../chat/chat-writer'
import { coachActionLabel } from '../overlay/labels'
import type { ToastSpec } from '../overlay/toasts'
import type { SessionFlow } from './session-flow'
import type { Thinking } from './thinking'

export const ASK_THREAD = 'ask'

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
}

export interface AskOptions {
  /** The field a `/d` line was typed in; writes are skipped if it changed. */
  expect?: FieldSnapshot | null
  /** 'replaceAll' replaces a `/d …` line that is the whole content of the chat box. */
  mode?: 'insert' | 'replaceAll'
  signal?: AbortSignal
}

export class AskFlow {
  constructor(private readonly deps: AskFlowDeps) {}

  /** Ask bar: reply + remaining actions as chips; `pasted` when a prompt went into the chat. */
  async submit(text: string, opts: AskOptions = {}): Promise<AskResult> {
    const { reply, actions } = await this.converse(text, opts.signal)
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
      this.deps.overlay.showToast({ kind: 'tip', title: 'Dumbledore', body: reply, ttlMs: 12_000 })
    }
    return { reply, actions: remaining, pasted }
  }

  /** `/d …` typed in a field: same turn, answered with a toast and action buttons. */
  async instruction(text: string, opts: AskOptions = {}): Promise<AskResult> {
    const result = await this.submit(text, opts)
    if (!result.pasted && !opts.signal?.aborted) {
      const runAction = this.deps.runAction
      this.deps.overlay.showToast({
        kind: 'tip',
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

  private async converse(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ reply: string; actions: CoachAction[] }> {
    const { repos, brain, thinking } = this.deps
    const history = repos.chat
      .history(ASK_THREAD, 10)
      .map((m) => ({ role: m.role, content: m.content }))
    repos.chat.append({ thread: ASK_THREAD, role: 'user', content: text, actions: [] })
    let reply = ''
    const actions: CoachAction[] = []
    await thinking.run('Thinking…', async () => {
      const events = brain.coach(
        {
          profile: repos.profile.get().summary,
          context: this.deps.contextText(),
          history,
          message: text,
        },
        { signal },
      )
      for await (const event of events) {
        if (event.type === 'text') reply += event.delta
        else if (event.type === 'action') actions.push(event.action)
      }
    })
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
