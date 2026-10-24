/**
 * Ask bar logic: `ask.submit` with the reply streamed from 'chat.delta' while it is written,
 * then the final markdown reply and its action chips (`coach.runAction`, then the bar closes).
 * Only the latest question's answer is kept; a stale reply never overwrites a newer one.
 */
import type { CoachAction } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, report } from '../overlay/lib/bridge'

/** chat.delta threads that belong to the Ask bar (main's naming is not pinned down yet). */
export const ASK_THREADS: ReadonlySet<string> = new Set(['ask', 'askbar'])

export type AskPhase = 'idle' | 'loading' | 'done' | 'error'

export interface AskView {
  phase: AskPhase
  question: string
  streamed: string
  result: AskResult | null
  error: string | null
}

const IDLE: AskView = { phase: 'idle', question: '', streamed: '', result: null, error: null }

export interface AskController {
  view: AskView
  submit: (text: string) => void
  reset: () => void
  runAction: (action: CoachAction) => Promise<void>
  close: () => void
}

export function useAsk(api: DumbledoreApi): AskController {
  const [view, setView] = useState<AskView>(IDLE)
  const request = useRef(0)

  useEffect(
    () =>
      api.on('chat.delta', (d) => {
        if (!ASK_THREADS.has(d.thread) || !d.delta) return
        setView((v) => (v.phase === 'loading' ? { ...v, streamed: v.streamed + d.delta } : v))
      }),
    [api],
  )

  const submit = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question) return
      const id = ++request.current
      setView({ ...IDLE, phase: 'loading', question })
      api
        .invoke('ask.submit', { text: question })
        .then((result) => {
          if (id === request.current) setView((v) => ({ ...v, phase: 'done', result }))
        })
        .catch((error: unknown) => {
          if (id === request.current)
            setView((v) => ({ ...v, phase: 'error', error: errorMessage(error) }))
        })
    },
    [api],
  )

  const reset = useCallback(() => {
    request.current++
    setView(IDLE)
  }, [])

  const close = useCallback(() => {
    api.invoke('window.close', 'askbar').catch((e: unknown) => report(e, 'window.close'))
  }, [api])

  const runAction = useCallback(
    async (action: CoachAction) => {
      try {
        await api.invoke('coach.runAction', action)
        close()
      } catch (error) {
        setView((v) => ({ ...v, phase: 'error', error: errorMessage(error) }))
      }
    },
    [api, close],
  )

  return { view, submit, reset, runAction, close }
}
