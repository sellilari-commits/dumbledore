/**
 * macOS permissions, shared by Settings and Onboarding: what each one is for, a hook that
 * polls their live status while one is missing, and the status control (✓ Granted, or
 * "Open System Settings" / "Turn on" → waiting until macOS reports the switch flipped). Both
 * permissions are required: Screen Recording stays on so PDFs, slides and video can be read.
 * macOS applies a new Screen Recording grant only to a fresh process, so while waiting for it
 * the control also offers "Quit & reopen".
 */
import { Button, Spinner } from '@renderer/design-system'
import { useAction, useAppState, usePermissions } from '@renderer/lib/queries'
import type { PermissionsStatus } from '@shared/state'
import { useState } from 'react'
import { OkLabel } from './ui'

export type PermissionKind = keyof PermissionsStatus

export const PERMISSIONS: ReadonlyArray<{
  kind: PermissionKind
  title: string
  required: boolean
  description: string
  /** What is missing while it is off (Settings shows it instead of the description). */
  off: string
}> = [
  {
    kind: 'accessibility',
    title: 'Accessibility',
    required: true,
    description: 'Lets Dumbledore read the text on screen and paste prompts into chat boxes.',
    off: 'Off — Dumbledore can’t read the screen or paste prompts',
  },
  {
    kind: 'screenRecording',
    title: 'Screen Recording',
    required: true,
    description: 'So Dumbledore can read PDFs, slides and video.',
    off: 'Off — Dumbledore can’t read PDFs, slides or video',
  },
]

export function usePermissionFlow(alwaysPoll = false) {
  const [waiting, setWaiting] = useState<Partial<Record<PermissionKind, boolean>>>({})
  const anyWaiting = Object.values(waiting).some(Boolean)
  const status = usePermissions(alwaysPoll || anyWaiting)
  const open = useAction('permissions.open')
  const relaunch = useAction('app.relaunch')
  // Without the helper nothing can check (or use) the permissions: they read "off" forever.
  const helperDown = useAppState().data?.helper === 'down'
  const request = (kind: PermissionKind) => {
    setWaiting((w) => ({ ...w, [kind]: true }))
    open.mutate(kind)
  }
  const granted = (kind: PermissionKind) => status.data?.[kind] === true
  const isWaiting = (kind: PermissionKind) => Boolean(waiting[kind]) && !granted(kind)
  return {
    status,
    request,
    granted,
    isWaiting,
    helperDown,
    relaunch: () => relaunch.mutate(undefined),
  }
}

/** Shown instead of a silent "off" when the helper (which checks the permissions) isn't running. */
export function HelperDownNote({ onRelaunch }: { onRelaunch: () => void }) {
  return (
    <p className="dd-set-bad" role="alert">
      Dumbledore’s screen helper isn’t running, so it can’t check these.{' '}
      <Button size="xs" variant="ghost" onClick={onRelaunch}>
        Quit &amp; reopen
      </Button>
    </p>
  )
}

export function PermissionControl({
  granted,
  waiting,
  onOpen,
  onRelaunch,
  title,
  actionLabel = 'Open System Settings',
}: {
  granted: boolean
  waiting: boolean
  onOpen: () => void
  /** Shown while waiting: for a grant macOS applies only after a restart (Screen Recording). */
  onRelaunch?: () => void
  title: string
  actionLabel?: string
}) {
  if (granted) return <OkLabel>Granted</OkLabel>
  if (waiting)
    return (
      <span
        className="dd-set-muted"
        style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}
      >
        <Spinner size={12} />
        Waiting for macOS…
        <Button size="xs" variant="ghost" onClick={onOpen}>
          Open again
        </Button>
        {onRelaunch ? (
          <Button size="xs" variant="ghost" onClick={onRelaunch}>
            Turned it on? Quit &amp; reopen
          </Button>
        ) : null}
      </span>
    )
  return (
    <Button size="sm" onClick={onOpen} aria-label={`Open System Settings for ${title}`}>
      {actionLabel}
    </Button>
  )
}
