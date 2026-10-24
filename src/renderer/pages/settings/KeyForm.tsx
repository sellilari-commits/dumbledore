/**
 * API key entry shared by Settings → AI providers and Onboarding: a password field and Save.
 * The key goes to the macOS Keychain through 'secrets.set' and is never shown again; saving
 * also invalidates the provider's cached connection check, so its status refreshes by itself.
 */
import { Button, Input, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import type { InvokeReq } from '@shared/ipc'
import { type FormEvent, useState } from 'react'

export type SecretKey = InvokeReq<'secrets.set'>['key']

export interface KeyFormProps {
  id: SecretKey
  name: string
  placeholder: string
  onSaved?: () => void
  onCancel?: () => void
  autoFocus?: boolean
  width?: number
}

export function KeyForm({
  id,
  name,
  placeholder,
  onSaved,
  onCancel,
  autoFocus,
  width = 200,
}: KeyFormProps) {
  const [draft, setDraft] = useState('')
  const save = useAction('secrets.set', {
    onSuccess: () => {
      setDraft('')
      toast(`${name} key saved to your Keychain`, { tone: 'success' })
      onSaved?.()
    },
    onError: (err) => toast(`Couldn’t save the key: ${err.message}`, { tone: 'error' }),
  })
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (draft.trim()) save.mutate({ key: id, value: draft.trim() })
  }
  return (
    <form onSubmit={submit} className="dd-set-keyform">
      <Input
        type="password"
        aria-label={`${name} API key`}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width }}
      />
      <Button type="submit" disabled={!draft.trim()} loading={save.isPending}>
        Save
      </Button>
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </form>
  )
}
