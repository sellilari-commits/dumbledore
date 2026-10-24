/**
 * The Ask bar's study mode (right ⌥ hold): main opens the bar with route 'prompt' (`#/prompt` on
 * the first load, a 'navigate' event after that). The student says what they want to study; ↵
 * sends it as `prompt.write`, main picks or makes the subject, builds its roadmap (the bar shows
 * its thinking state), closes the bar and pastes the first step's prompt into the AI chat. A failure keeps the text and shows an
 * error line. The mode ends when the bar loses focus (unless a prompt is being written), so a later
 * plain open (double-tap) shows the chat with Dumbledore.
 */

import { isPromptRoute } from '@shared/chat-panel'
import type { DumbledoreApi } from '@shared/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, report } from '../overlay/lib/bridge'

export interface PromptBoxController {
  active: boolean
  /** The AI chat the prompt goes into ("ChatGPT"); null when none is open. */
  assistant: string | null
  busy: boolean
  error: string | null
  /** Resolves true once main has written (and pasted or copied) the prompt. */
  submit: (context: string) => Promise<boolean>
  dismissError: () => void
  exit: () => void
}

export { isPromptRoute }

/** The one-line hint under the input: where the prompt will go. */
export function promptHint(assistant: string | null): string {
  return assistant
    ? `Dumbledore builds a roadmap and pastes its first prompt into ${assistant}.`
    : 'No AI chat is open: Dumbledore builds the roadmap and opens it for you.'
}

export function usePromptBox(api: DumbledoreApi): PromptBoxController {
  const [active, setActive] = useState(() => isPromptRoute(window.location.hash))
  const [assistant, setAssistant] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const writing = useRef(false)

  const exit = useCallback(() => {
    if (writing.current) return
    setActive(false)
    setError(null)
  }, [])

  const enter = useCallback((on: boolean) => {
    if (writing.current) return
    setActive(on)
    setError(null)
  }, [])

  useEffect(() => {
    const onHash = () => enter(isPromptRoute(window.location.hash))
    const off = api.on('navigate', ({ route }) => enter(isPromptRoute(route)))
    window.addEventListener('hashchange', onHash)
    window.addEventListener('blur', exit)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('blur', exit)
    }
  }, [api, enter, exit])

  useEffect(() => {
    if (!active) return
    let live = true
    api
      .invoke('app.getState')
      .then((state) => {
        if (live) setAssistant(state.aiChat?.provider ?? null)
      })
      .catch((e: unknown) => report(e, 'app.getState'))
    return () => {
      live = false
    }
  }, [api, active])

  const submit = useCallback(
    async (context: string): Promise<boolean> => {
      const wish = context.trim()
      if (!wish || writing.current) return false
      writing.current = true
      setBusy(true)
      setError(null)
      try {
        await api.invoke('prompt.write', { context: wish })
        setActive(false)
        return true
      } catch (e) {
        setError(errorMessage(e))
        return false
      } finally {
        writing.current = false
        setBusy(false)
      }
    },
    [api],
  )

  const dismissError = useCallback(() => setError(null), [])

  return { active, assistant, busy, error, submit, dismissError, exit }
}
