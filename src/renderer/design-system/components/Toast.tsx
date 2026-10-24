/**
 * Toasts for in-window confirmations ("Prompt copied"): a tiny zustand store, `toast()` to
 * show one from anywhere, and <Toaster/> mounted once per window. Dark pill, bottom centre,
 * auto-hides (hover pauses), Esc-free — like Notion's.
 */
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { cx } from '../cx'
import '../styles/overlays.css'

export interface ToastItem {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  ttlMs: number
}

interface ToastStore {
  toasts: ToastItem[]
  push(t: Omit<ToastItem, 'id'>): number
  dismiss(id: number): void
}

let nextId = 1

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function toast(
  text: string,
  opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; ttlMs?: number } = {},
): number {
  return useToasts.getState().push({
    text,
    tone: opts.tone ?? 'info',
    action: opts.action,
    ttlMs: opts.ttlMs ?? 4000,
  })
}

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = () => {
    timer.current = setTimeout(() => dismiss(item.id), item.ttlMs)
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: start once per toast
  useEffect(() => {
    start()
    return stop
  }, [])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering only pauses the auto-hide timer
    <div
      className={cx('dd-toast', `dd-toast--${item.tone}`)}
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      {item.tone !== 'info' ? (
        <span className="dd-toast__icon" aria-hidden>
          {item.tone === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
        </span>
      ) : null}
      <span className="dd-toast__text">{item.text}</span>
      {item.action ? (
        <button
          type="button"
          className="dd-toast__action"
          onClick={() => {
            item.action?.onClick()
            dismiss(item.id)
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="dd-toast__close"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="dd-toaster" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  )
}
