/**
 * Small panel helpers: open the full app on a route, hide this window, report a failure as an
 * error toast, run a coach action (coach.runAction), and close on an unhandled Esc.
 */
import { toast } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { useAction } from '@renderer/lib/queries'
import { useEffect, useRef } from 'react'

export function report(error: unknown): void {
  const text =
    error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.'
  toast(text, { tone: 'error' })
}

/** Shows the full app window, optionally on a route (see APP_ROUTES). */
export function openApp(route: string | null = null): void {
  invoke('window.open', { surface: 'app', route }).catch(report)
}

/** Hides the panel window; main keeps it around for the next open. */
export function closePanel(): void {
  invoke('window.close', 'panel').catch(report)
}

/** coach.runAction with failures shown as a toast. */
export function useRunAction() {
  return useAction('coach.runAction', { onError: report })
}

/**
 * Calls `onEscape` for an Esc nothing else handled: open menus and inputs that use Esc
 * themselves call preventDefault first.
 */
export function useEscape(onEscape: () => void): void {
  const latest = useRef(onEscape)
  useEffect(() => {
    latest.current = onEscape
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      e.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
