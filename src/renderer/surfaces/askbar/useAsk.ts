/**
 * Ask bar chat logic for thread 'ask': the stored conversation since the last "New chat"
 * (`chat.history`, reloaded whenever the bar comes back), `ask.submit` (with the selected topic's
 * `subjectId`) with the reply streamed
 * from 'chat.delta' while it is written, action chips per reply (`coach.runAction`, then the bar
 * closes) and "New chat". One question at a time; a reply that lands after "New chat" is dropped.
 */
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, report } from '../overlay/lib/bridge'
import { ASK_THREAD, ASK_THREADS, currentChat, loadSince, saveSince } from './askHistory'

/** A chat message, plus the "pasted into the chat box" note for replies sent from this window. */
export interface AskMessage extends ChatMessage {
  pasted?: boolean
}

/** The reply being written: '' until the first streamed words arrive. */
export interface AskPending {
  text: string
  /** The chat.delta message id it streams under (the first one seen wins). */
  streamId: string | null
}

export interface AskError {
  message: string
  /** A failed question can be sent again with ↵; a failed action can't. */
  retry: boolean
}

export interface AskController {
  messages: AskMessage[]
  pending: AskPending | null
  error: AskError | null
  /**
   * Sends a question (with the selected topic, if any); resolves false when it wasn't answered
   * (the bar puts the text back).
   */
  submit: (text: string, subjectId?: string | null) => Promise<boolean>
  /** Starts over: hides the conversation and leaves it out of the context from now on. */
  newChat: () => void
  /** Reloads the stored conversation (a `/d` line or another window may have added to it). */
  refresh: () => void
  dismissError: () => void
  runAction: (action: CoachAction) => Promise<void>
  close: () => void
}

let localSeq = 0

function localMessage(role: ChatMessage['role'], content: string, extra?: Partial<AskMessage>) {
  const message: AskMessage = {
    id: `local_${++localSeq}`,
    thread: ASK_THREAD,
    role,
    content,
    actions: [],
    createdAt: new Date().toISOString(),
    ...extra,
  }
  return message
}

/** Stored messages, reusing the objects already on screen (no re-render) and their notes. */
function merge(stored: ChatMessage[], prev: AskMessage[]): AskMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]))
  const pasted = new Set(prev.filter((m) => m.pasted).map((m) => m.content))
  const next = stored.map(
    (m) =>
      byId.get(m.id) ??
      (m.role === 'assistant' && pasted.has(m.content) ? { ...m, pasted: true } : m),
  )
  return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next
}

export function useAsk(api: DumbledoreApi): AskController {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [pending, setPending] = useState<AskPending | null>(null)
  const [error, setError] = useState<AskError | null>(null)
  const since = useRef<string | null | undefined>(undefined)
  if (since.current === undefined) since.current = loadSince()
  const inFlight = useRef(false)
  /** Bumped by every question and "New chat": anything that started before is stale. */
  const version = useRef(0)

  const refresh = useCallback(() => {
    if (inFlight.current) return
    const started = version.current
    api
      .invoke('chat.history', ASK_THREAD)
      .then((stored) => {
        if (started !== version.current || inFlight.current) return
        setMessages((prev) => merge(currentChat(stored, since.current ?? null), prev))
      })
      .catch((e: unknown) => report(e, 'chat.history'))
  }, [api])

  useEffect(() => refresh(), [refresh])

  useEffect(
    () =>
      api.on('chat.delta', (d) => {
        if (!ASK_THREADS.has(d.thread) || !d.delta) return
        setPending((p) =>
          !p || (p.streamId !== null && p.streamId !== d.messageId)
            ? p
            : { streamId: d.messageId, text: p.text + d.delta },
        )
      }),
    [api],
  )

  const submit = useCallback(
    async (text: string, subjectId?: string | null): Promise<boolean> => {
      const question = text.trim()
      if (!question || inFlight.current) return false
      inFlight.current = true
      const id = ++version.current
      const mine = localMessage('user', question)
      setError(null)
      setMessages((m) => [...m, mine])
      setPending({ text: '', streamId: null })
      const after = since.current
      try {
        const result = await api.invoke('ask.submit', {
          text: question,
          ...(after ? { since: after } : {}),
          ...(subjectId ? { subjectId } : {}),
        })
        if (id === version.current) {
          const { reply, actions, pasted } = result
          setMessages((m) => [...m, localMessage('assistant', reply, { actions, pasted })])
        }
        return true
      } catch (e) {
        if (id === version.current) {
          setMessages((m) => m.filter((x) => x !== mine))
          setError({ message: errorMessage(e), retry: true })
        }
        return false
      } finally {
        if (id === version.current) {
          inFlight.current = false
          setPending(null)
        }
      }
    },
    [api],
  )

  const newChat = useCallback(() => {
    if (inFlight.current) return
    const now = new Date().toISOString()
    since.current = now
    saveSince(now)
    version.current++
    setMessages([])
    setError(null)
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const close = useCallback(() => {
    api.invoke('window.close', 'askbar').catch((e: unknown) => report(e, 'window.close'))
  }, [api])

  const runAction = useCallback(
    async (action: CoachAction) => {
      try {
        await api.invoke('coach.runAction', action)
        // Undo of a note keeps the chat open, so the student can go on writing notes.
        if (action.type === 'undo_note') {
          setMessages((list) => [...list, localMessage('assistant', 'Note removed.')])
          return
        }
        close()
      } catch (e) {
        setError({ message: errorMessage(e), retry: false })
      }
    },
    [api, close],
  )

  return { messages, pending, error, submit, newChat, refresh, dismissError, runAction, close }
}
