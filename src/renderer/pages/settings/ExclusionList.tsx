/**
 * An editable list for Settings → Capture & privacy: apps or sites Dumbledore never looks at.
 * Rows show a hover-only remove button; an input at the bottom adds new entries.
 */
import { Button, IconButton, Input } from '@renderer/design-system'
import { X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { SettingsRow } from './ui'

export interface ExclusionListProps {
  label: string
  description: string
  values: string[]
  placeholder: string
  emptyText: string
  /** Cleans user input (e.g. a pasted URL → its host); return null to reject. */
  normalize?: (raw: string) => string | null
  onChange: (values: string[]) => void
}

export function hostFromInput(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  if (!text) return null
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    return url.host.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export function ExclusionList({
  label,
  description,
  values,
  placeholder,
  emptyText,
  normalize = (raw) => raw.trim() || null,
  onChange,
}: ExclusionListProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = (e?: FormEvent) => {
    e?.preventDefault()
    const value = normalize(draft)
    if (!value) {
      setError('That doesn’t look right.')
      return
    }
    if (values.includes(value)) {
      setError('Already on the list.')
      return
    }
    onChange([...values, value])
    setDraft('')
    setError(null)
  }
  return (
    <SettingsRow label={label} description={description} stacked>
      <div className="dd-set-list">
        {values.length === 0 ? <div className="dd-set-list__empty">{emptyText}</div> : null}
        {values.map((v) => (
          <div className="dd-set-list__item" key={v}>
            <span>{v}</span>
            <IconButton
              label={`Remove ${v}`}
              size="sm"
              className="dd-set-list__remove"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <X size={14} />
            </IconButton>
          </div>
        ))}
        <form className="dd-set-list__add" onSubmit={add}>
          <Input
            aria-label={`Add to ${label.toLowerCase()}`}
            placeholder={placeholder}
            value={draft}
            invalid={error !== null}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
          />
          <Button type="submit" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
      </div>
      {error ? (
        <div className="dd-set-bad" role="alert">
          {error}
        </div>
      ) : null}
    </SettingsRow>
  )
}
