/**
 * A pausable countdown: calls `onDone` once after `ms` of un-paused time. `ms <= 0` never fires
 * (a sticky toast). Pausing keeps the remaining time, so hovering a toast really holds it.
 */
import { useEffect, useRef } from 'react'

export function useCountdown(ms: number, paused: boolean, onDone: () => void): void {
  const remaining = useRef(ms)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (paused || ms <= 0 || remaining.current <= 0) return
    const startedAt = Date.now()
    const timer = window.setTimeout(() => {
      remaining.current = 0
      done.current()
    }, remaining.current)
    return () => {
      window.clearTimeout(timer)
      if (remaining.current > 0) remaining.current -= Date.now() - startedAt
    }
  }, [paused, ms])
}
