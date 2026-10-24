/**
 * Browser mock for the Ask bar (no Electron, or `?mock=1`): a tiny fake main with thread 'ask' in
 * memory. `ask.submit` stores both turns and streams the canned reply as 'chat.delta';
 * `chat.history` serves the thread; the choose view gets demo subjects. URL options:
 * `?seed=<turns>` starts with an earlier conversation, `?theme=dark|light` forces a theme,
 * `#/choose` opens the choose view. `window.__ddMock.calls` logs every call (Playwright reads it).
 */
import type { ChatMessage } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import { createLocalApi } from '../../overlay/lib/localApi'
import { ASK_THREAD } from '../askHistory'
import { cannedReply, demoPicker, SEED_QUESTIONS } from './askReplies'

const CHUNK_MS = 35

export function createAskMock(search: string = window.location.search): DumbledoreApi {
  const params = new URLSearchParams(search)
  const theme = params.get('theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme

  const thread: ChatMessage[] = []
  let seq = 0
  const add = (role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>) => {
    const message: ChatMessage = {
      id: `msg_${++seq}`,
      thread: ASK_THREAD,
      role,
      content,
      actions: [],
      createdAt: new Date().toISOString(),
      ...extra,
    }
    thread.push(message)
    return message
  }

  const turns = Math.min(Number(params.get('seed')) || 0, SEED_QUESTIONS.length)
  SEED_QUESTIONS.slice(0, turns).forEach((question, i) => {
    const createdAt = (k: number) => new Date(Date.now() - (turns - i) * 120_000 + k).toISOString()
    const { reply, actions } = cannedReply(question)
    add('user', question, { createdAt: createdAt(0) })
    add('assistant', reply, { actions, createdAt: createdAt(1) })
  })

  const local = createLocalApi('askbar', {
    'chat.history': (name) => thread.filter((m) => m.thread === name),
    'ask.submit': async ({ text }) => {
      add('user', text)
      const result = cannedReply(text)
      const messageId = `ask_pending_${seq}`
      const words = result.reply.split(/(?<= )/)
      for (let i = 0; i < words.length; i += 3) {
        await new Promise((r) => window.setTimeout(r, CHUNK_MS))
        const delta = words.slice(i, i + 3).join('')
        local.emit('chat.delta', { thread: ASK_THREAD, messageId, delta, done: false })
      }
      local.emit('chat.delta', { thread: ASK_THREAD, messageId, delta: '', done: true })
      add('assistant', result.reply, { actions: result.actions })
      return result
    },
    'session.picker': () => demoPicker(),
    'session.start': () => {
      throw new Error('The mock has no study sessions')
    },
    'coach.runAction': () => undefined,
    'window.close': () => undefined,
    'window.setSize': () => undefined,
  })

  window.__ddMock = {
    state: () => {
      throw new Error('No overlay state on the Ask bar')
    },
    scene: () => undefined,
    actions: [],
    calls: local.calls,
  }
  return local.api
}
