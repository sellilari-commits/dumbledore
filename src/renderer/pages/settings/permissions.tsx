/**
 * macOS permissions, shared by Settings and Onboarding: what each one is for, a hook that
 * polls their live status while one is missing, and the status control (✓ Granted, or
 * "Open System Settings" → waiting until macOS reports the switch flipped).
 */
import { Button, Spinner } from '@renderer/design-system'
import { useAction, usePermissions } from '@renderer/lib/queries'
import type { PermissionsStatus } from '@shared/state'
import { useState } from 'react'
import { OkLabel } from './ui'

export type PermissionKind = keyof PermissionsStatus

export const PERMISSIONS: ReadonlyArray<{
  kind: PermissionKind
  title: string
  required: boolean
  description: string
}> = [
  {
    kind: 'accessibility',
    title: 'Accessibility',
    required: true,
    description: 'Lets Dumbledore read the text on screen and paste prompts into chat boxes.',
  },
  {
    kind: 'screenRecording',
    title: 'Screen Recording',
    required: false,
    description: 'Only for slides, scanned PDFs and video, where text exists only as pixels.',
  },
]

export function usePermissionFlow(alwaysPoll = false) {
  const [waiting, setWaiting] = useState<Partial<Record<PermissionKind, boolean>>>({})
  const anyWaiting = Object.values(waiting).some(Boolean)
  const status = usePermissions(alwaysPoll || anyWaiting)
  const open = useAction('permissions.open')
  const request = (kind: PermissionKind) => {
    setWaiting((w) => ({ ...w, [kind]: true }))
    open.mutate(kind)
  }
  const granted = (kind: PermissionKind) => status.data?.[kind] === true
  const isWaiting = (kind: PermissionKind) => Boolean(waiting[kind]) && !granted(kind)
  return { status, request, granted, isWaiting }
}

export function PermissionControl({
  granted,
  waiting,
  onOpen,
  title,
}: {
  granted: boolean
  waiting: boolean
  onOpen: () => void
  title: string
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
      </span>
    )
  return (
    <Button size="sm" onClick={onOpen} aria-label={`Open System Settings for ${title}`}>
      Open System Settings
    </Button>
  )
}
