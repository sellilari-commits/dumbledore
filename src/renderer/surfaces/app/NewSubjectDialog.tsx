/**
 * ⌘N "New subject": emoji (picked from a small study set), name, optional goal and deadline.
 * Creates it through 'subjects.create' and opens the new subject page.
 */
import { Button, Dialog, Field, Input, Popover, PopoverClose, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'

export const SUBJECT_EMOJI = [
  '📘',
  '🧪',
  '📐',
  '🌍',
  '🧬',
  '⚛️',
  '🧮',
  '📊',
  '💻',
  '🏛️',
  '📜',
  '🎨',
  '🎵',
  '🗣️',
  '🇫🇮',
  '🇪🇸',
  '⚖️',
  '💼',
  '🩺',
  '🧠',
  '🌱',
  '🔭',
  '✍️',
  '📈',
]

export function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <Popover
      label="Pick an icon"
      trigger={
        <button
          type="button"
          className="dd-btn dd-btn--secondary"
          aria-label={`Icon ${value}, change`}
          style={{ width: 40, padding: 0, fontSize: 18 }}
        >
          {value}
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 32px)', gap: 2 }}>
        {SUBJECT_EMOJI.map((e) => (
          <PopoverClose asChild key={e}>
            <button
              type="button"
              className="dd-icon-btn"
              style={{ width: 32, height: 32, fontSize: 18 }}
              aria-label={`Use ${e}`}
              onClick={() => onChange(e)}
            >
              {e}
            </button>
          </PopoverClose>
        ))}
      </div>
    </Popover>
  )
}

export function NewSubjectDialog() {
  const open = useShell((s) => s.newSubjectOpen)
  const setOpen = useShell((s) => s.setNewSubject)
  const [, navigate] = useLocation()
  const [emoji, setEmoji] = useState('📘')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [deadline, setDeadline] = useState('')
  const create = useAction('subjects.create')

  const reset = () => {
    setEmoji('📘')
    setName('')
    setGoal('')
    setDeadline('')
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        name: name.trim(),
        emoji,
        goal: goal.trim() || null,
        deadline: deadline ? new Date(`${deadline}T09:00:00`).toISOString() : null,
      },
      {
        onSuccess: (subject) => {
          setOpen(false)
          reset()
          navigate(`/subjects/${subject.id}/roadmap`)
          toast(`${subject.emoji} ${subject.name} added`, { tone: 'success' })
        },
        onError: (err) => toast(err.message, { tone: 'error' }),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="New subject"
      description="Dumbledore files what you read under your subjects and builds roadmaps for them."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => submit()}
            disabled={!name.trim()}
            loading={create.isPending}
          >
            Create subject
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Name">
          {(id) => (
            <div style={{ display: 'flex', gap: 8 }}>
              <EmojiPicker value={emoji} onChange={setEmoji} />
              <Input
                id={id}
                autoFocus
                placeholder="e.g. Organic Chemistry"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
        </Field>
        <Field label="Goal" hint="Optional — what does “done” look like?">
          {(id) => (
            <Input
              id={id}
              placeholder="Pass the midterm"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          )}
        </Field>
        <Field label="Deadline" hint="Optional — reviews ramp up before it.">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}
