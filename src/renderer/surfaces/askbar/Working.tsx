/**
 * The Ask bar's working indicator: three calmly pulsing dots and what Dumbledore is doing right
 * now ("Thinking…", "Reading your roadmap…"), where the reply will appear. Each label stays up
 * at least HOLD_MS so quick tool calls don't flicker past unread; only the latest waiting label is
 * shown next. Screen readers hear the steps through the reply bubble's aria-live (AskLog). With
 * prefers-reduced-motion the dots only fade slowly (askbar.css).
 */
import { useEffect, useRef, useState } from 'react'

export const HOLD_MS = 600

/** `label`, changing at most once per `holdMs`; the newest label wins. */
export function useHeldLabel(label: string, holdMs = HOLD_MS): string {
  const [shown, setShown] = useState(label)
  const since = useRef(Date.now())
  useEffect(() => {
    if (label === shown) return
    const wait = Math.max(0, since.current + holdMs - Date.now())
    const timer = window.setTimeout(() => {
      since.current = Date.now()
      setShown(label)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [label, shown, holdMs])
  return shown
}

export function Working({ label }: { label: string }) {
  const shown = useHeldLabel(label)
  return (
    <p className="ask__working">
      <span className="ask__dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="ask__step">{shown}</span>
    </p>
  )
}
