/**
 * Toasts that grow out of the orb: 320 pt Notion cards with a title, one sentence and up to two
 * buttons. Each auto-hides after its ttlMs (hovering pauses it); auto-hide and × both collapse
 * the card back into the orb and send toastDismiss — main turns an ignored nudge into the dot.
 * The newest toast sits nearest the orb; at most three show at once.
 */
import type { OverlayAction, Toast } from '@shared/state'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Anchor, anchorStyle } from '../lib/layout'
import { useCountdown } from './useCountdown'
import './toast.css'

export const TOAST_WIDTH = 320
const MAX_VISIBLE = 3
const LEAVE_MS = 180

interface Props {
  toasts: Toast[]
  anchor: Anchor
  send: (action: OverlayAction) => void
}

export function ToastStack({ toasts, anchor, send }: Props) {
  // Toasts this page already let go of, hidden until main drops them from the state.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    setGone((prev) => {
      const live = new Set(toasts.map((t) => t.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [toasts])

  const forget = (id: string) => setGone((prev) => new Set(prev).add(id))
  const visible = toasts.filter((t) => !gone.has(t.id)).slice(-MAX_VISIBLE)
  if (visible.length === 0) return null

  return (
    <div
      className="ov-sat ov-toasts"
      data-grow={anchor.top !== undefined ? 'down' : 'up'}
      style={anchorStyle({ ...anchor, maxHeight: undefined })}
    >
      {visible.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          origin={anchor.origin}
          onAction={(actionId) => send({ type: 'toastAction', toastId: toast.id, actionId })}
          onDismiss={() => send({ type: 'toastDismiss', toastId: toast.id })}
          onGone={() => forget(toast.id)}
        />
      ))}
    </div>
  )
}

interface CardProps {
  toast: Toast
  origin: string
  /** Sent at once; the card fades out meanwhile. */
  onAction: (actionId: string) => void
  /** Sent once the card has collapsed into the orb. */
  onDismiss: () => void
  /** The card finished leaving. */
  onGone: () => void
}

function ToastCard({ toast, origin, onAction, onDismiss, onGone }: CardProps) {
  const [hovered, setHovered] = useState(false)
  const [leaving, setLeaving] = useState<'collapse' | 'fade' | null>(null)

  const leave = (mode: 'collapse' | 'fade', then: () => void) => {
    if (leaving) return
    setLeaving(mode)
    window.setTimeout(then, prefersReducedMotion() ? 0 : LEAVE_MS)
  }
  const dismiss = () =>
    leave('collapse', () => {
      onDismiss()
      onGone()
    })
  const act = (actionId: string) => {
    if (leaving) return
    onAction(actionId)
    leave('fade', onGone)
  }

  useCountdown(toast.ttlMs, hovered || leaving !== null, dismiss)

  const actions = toast.actions.slice(0, 2)
  return (
    <div
      className="ov-toast"
      data-hit=""
      data-kind={toast.kind}
      data-leaving={leaving ?? undefined}
      data-testid="toast"
      role={toast.kind === 'error' ? 'alert' : 'status'}
      style={{ transformOrigin: origin }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="ov-toast__head">
        {toast.kind === 'tip' && (
          <span className="ov-toast__icon" aria-hidden>
            💡
          </span>
        )}
        <span className="ov-toast__title">{toast.title}</span>
        <button
          type="button"
          className="ov-icon-btn ov-toast__close"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {toast.body && <p className="ov-toast__body">{toast.body}</p>}
      {actions.length > 0 && (
        <div className="ov-toast__actions">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.primary ? 'ov-btn ov-btn--primary' : 'ov-btn'}
              onClick={() => act(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
