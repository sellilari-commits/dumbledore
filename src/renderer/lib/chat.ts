/**
 * Coach chat for one thread: history from 'chat.history', optimistic user messages, and the
 * assistant reply streamed in through 'chat.delta' until the stored message replaces it.
 */
import type { ChatMessage } from '@shared/domain'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, on } from './api'
import { keys, useChatHistory } from './queries'

export interface ChatView {
  messages: ChatMessage[]
  /** Text of the reply that is streaming in right now ('' while waiting for the first token). */
  streaming: { id: string | null; text: string } | null
  isLoading: boolean
  error: Error | null
  send(text: string): Promise<void>
  sending: boolean
}

/** Stable while history is loading or failed, so effects that depend on it don't loop. */
const NO_MESSAGES: ChatMessage[] = []

export function useChat(thread: string): ChatView {
  const qc = useQueryClient()
  const history = useChatHistory(thread)
  const [pending, setPending] = useState<ChatMessage[]>([])
  const [stream, setStream] = useState<{ id: string | null; text: string } | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(
    () =>
      on('chat.delta', (d) => {
        if (d.thread !== thread) return
        setStream((s) => ({
          id: d.messageId,
          text: (s && s.id === d.messageId ? s.text : '') + d.delta,
        }))
      }),
    [thread],
  )

  const stored = history.data ?? NO_MESSAGES
  // Drop the streaming bubble and optimistic messages once the stored history has them.
  useEffect(() => {
    if (stream?.id && stored.some((m) => m.id === stream.id)) setStream(null)
    setPending((p) => {
      const left = p.filter(
        (m) => !stored.some((s) => s.role === 'user' && s.content === m.content),
      )
      return left.length === p.length ? p : left
    })
  }, [stored, stream?.id])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const local: ChatMessage = {
        id: `local_${Date.now()}`,
        thread,
        role: 'user',
        content: trimmed,
        actions: [],
        createdAt: new Date().toISOString(),
      }
      setPending((p) => [...p, local])
      setStream({ id: null, text: '' })
      setSending(true)
      try {
        const reply = await invoke('chat.send', { thread, text: trimmed })
        qc.setQueryData<ChatMessage[]>(keys.chat(thread), (old = []) => {
          const withUser = old.some((m) => m.role === 'user' && m.content === trimmed)
            ? old
            : [...old, local]
          return withUser.some((m) => m.id === reply.id) ? withUser : [...withUser, reply]
        })
        setStream(null)
        void qc.invalidateQueries({ queryKey: keys.chat(thread) })
      } catch (err) {
        setStream(null)
        throw err
      } finally {
        setSending(false)
      }
    },
    [qc, thread],
  )

  const messages = useMemo(() => [...stored, ...pending], [stored, pending])
  return {
    messages,
    streaming: stream,
    isLoading: history.isLoading,
    error: history.error,
    send,
    sending,
  }
}
