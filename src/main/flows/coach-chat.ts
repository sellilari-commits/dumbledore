/**
 * Coach chat (panel and app "Chat"): stores both sides in the chat repo and streams the coach's
 * reply to the windows as `chat.delta` events. Deltas carry a provisional message id; the message
 * `chat.send` resolves with carries the stored id.
 */
import type { Brain } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import type { Thinking } from './thinking'

export interface CoachChatDeps {
  brain: Brain
  repos: Repos
  bus: EngineBus
  thinking: Thinking
  contextText: () => string
  emitDelta: (delta: EventPayload<'chat.delta'>) => void
}

const HISTORY_TURNS = 20

export class CoachChat {
  private seq = 0

  constructor(private readonly deps: CoachChatDeps) {}

  history(thread: string): ChatMessage[] {
    return this.deps.repos.chat.history(thread, 200)
  }

  async send(thread: string, text: string): Promise<ChatMessage> {
    const { repos, brain, bus, thinking, emitDelta } = this.deps
    const history = repos.chat
      .history(thread, HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))
    const mine = repos.chat.append({ thread, role: 'user', content: text, actions: [] })
    bus.emit('memory:changed', { scope: 'chat', ids: [mine.id] })
    const messageId = `msg_pending_${++this.seq}`
    let content = ''
    const actions: CoachAction[] = []
    try {
      await thinking.run('Thinking…', async () => {
        const events = brain.coach({
          profile: repos.profile.get().summary,
          context: this.deps.contextText(),
          history,
          message: text,
        })
        for await (const event of events) {
          if (event.type === 'text') {
            content += event.delta
            emitDelta({ thread, messageId, delta: event.delta, done: false })
          } else if (event.type === 'action') {
            actions.push(event.action)
          }
        }
      })
    } catch (error) {
      const note = "I couldn't reach the AI just now. Try again in a moment."
      content = content ? `${content}\n\n${note}` : note
      console.warn('[coach-chat] coach failed', error)
    }
    emitDelta({ thread, messageId, delta: '', done: true })
    const reply = repos.chat.append({ thread, role: 'assistant', content: content.trim(), actions })
    bus.emit('memory:changed', { scope: 'chat', ids: [reply.id] })
    return reply
  }
}
