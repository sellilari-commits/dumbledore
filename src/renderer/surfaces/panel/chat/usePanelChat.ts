/**
 * The panel's coach chat — lib/chat's useChat with one fix: while chat.history is loading or
 * has failed, lib's version re-renders without end (a fresh `[]` each render re-runs its effect,
 * whose setPending always returns a new array). Here the history array is memoised and pending
 * messages only change when one is actually confirmed. Same ChatView contract, so the panel can
 * switch back to lib's hook once it is fixed there.
 */
import { invoke, on } from '@renderer/lib/api'
import type { ChatView } from '@renderer/lib/chat'
import { keys, useChatHistory } from '@renderer/lib/queries'
import type { ChatMessage } from '@shared/domain'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

const NONE: ChatMessage[] = []

const confirmed = (stored: ChatMessage[], m: ChatMessage) =>
  stored.some((s) => s.role === 'user' && s.content === m.content)

export function usePanelChat(thread: string): ChatView {
  const qc = useQueryClient()
  const history = useChatHistory(thread)
  const stored = history.data ?? NONE
  const [pending, setPending] = useState<ChatMessage[]>(NONE)
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

  // Drop the streaming bubble and optimistic messages once the stored history has them.
  useEffect(() => {
    if (stream?.id && stored.some((m) => m.id === stream.id)) setStream(null)
    setPending((p) =>
      p.some((m) => confirmed(stored, m)) ? p.filter((m) => !confirmed(stored, m)) : p,
    )
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
        setPending((p) => p.filter((m) => m.id !== local.id))
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
