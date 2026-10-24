/**
 * Inline "Add deadline" row for Home (Notion's "+ New" row): title, date and an optional
 * subject, saved through assignments.add. Enter saves, Esc cancels.
 */
import { Button, Input, Menu, MenuItem, MenuSeparator, toast } from '@renderer/design-system'
import { formatDate } from '@renderer/lib/format'
import { useAction, useSubjects } from '@renderer/lib/queries'
import { ChevronDown } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useState } from 'react'

/** "2026-10-30" → end of that local day as ISO. */
export function endOfLocalDay(date: string): string {
  return new Date(`${date}T23:59:00`).toISOString()
}

function SubjectPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const subjects = useSubjects()
  const list = (subjects.data ?? []).filter((s) => s.status === 'active')
  const current = list.find((s) => s.id === value)
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className="dd-btn dd-btn--ghost dd-btn--sm hm-add__subject"
          aria-label="Subject"
        >
          <span className="hm-add__subject-label">
            {current ? `${current.emoji} ${current.name}` : 'No subject'}
          </span>
          <ChevronDown size={14} />
        </button>
      }
    >
      {list.map((s) => (
        <MenuItem
          key={s.id}
          icon={s.emoji}
          checked={s.id === value}
          onSelect={() => onChange(s.id)}
        >
          {s.name}
        </MenuItem>
      ))}
      {list.length > 0 ? <MenuSeparator /> : null}
      <MenuItem checked={value === null} onSelect={() => onChange(null)}>
        No subject
      </MenuItem>
    </Menu>
  )
}

export function AddDeadline({ onClose }: { onClose: () => void }) {
  const add = useAction('assignments.add')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const ready = title.trim().length > 0 && date.length > 0

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    add.mutate(
      { title: title.trim(), subjectId, dueAt: endOfLocalDay(date) },
      {
        onSuccess: (a) => {
          toast(`Added “${a.title}” · due ${a.dueAt ? formatDate(a.dueAt) : 'soon'}`, {
            tone: 'success',
          })
          onClose()
        },
        onError: (err) => toast(err.message, { tone: 'error' }),
      },
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <form className="hm-add" onSubmit={submit} onKeyDown={onKeyDown} aria-label="Add deadline">
      <Input
        autoFocus
        className="hm-add__title"
        aria-label="Deadline title"
        placeholder="e.g. Lab report"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Input
        type="date"
        className="hm-add__date"
        aria-label="Due date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <SubjectPicker value={subjectId} onChange={setSubjectId} />
      <div className="hm-add__buttons">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!ready} loading={add.isPending}>
          Add
        </Button>
      </div>
    </form>
  )
}
