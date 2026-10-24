/**
 * Onboarding's subject list: what the student added so far (emoji, name, deadline) and a
 * one-line form to add another — icon, name, optional deadline — through 'subjects.create'.
 */
import { Button, Input, toast } from '@renderer/design-system'
import { formatDate } from '@renderer/lib/format'
import { useAction, useSubjects } from '@renderer/lib/queries'
import { EmojiPicker } from '@renderer/surfaces/app/NewSubjectDialog'
import { CalendarClock } from 'lucide-react'
import { type FormEvent, useState } from 'react'

export function SubjectsCard() {
  const subjects = useSubjects()
  const listed = (subjects.data ?? []).filter((s) => s.status !== 'archived')
  const [emoji, setEmoji] = useState('📘')
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const create = useAction('subjects.create', {
    onSuccess: () => {
      setName('')
      setDeadline('')
      setEmoji('📘')
    },
    onError: (err) => toast(`Couldn’t add it: ${err.message}`, { tone: 'error' }),
  })
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    create.mutate({
      name: name.trim(),
      emoji,
      goal: null,
      deadline: deadline ? new Date(`${deadline}T09:00:00`).toISOString() : null,
    })
  }
  return (
    <div className="dd-onb__card">
      {listed.map((s) => (
        <div className="dd-onb__row dd-onb__row--compact" key={s.id}>
          <span className="dd-onb__emoji" aria-hidden>
            {s.emoji}
          </span>
          <div className="dd-onb__row-text">
            <div className="dd-onb__row-title">{s.name}</div>
          </div>
          {s.deadline ? (
            <span className="dd-onb__deadline">
              <CalendarClock size={14} strokeWidth={1.75} aria-hidden />
              {formatDate(s.deadline)}
            </span>
          ) : null}
        </div>
      ))}
      <form className="dd-onb__row dd-onb__row--compact dd-onb__add" onSubmit={submit}>
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <Input
          aria-label="Subject name"
          placeholder={listed.length ? 'Add another subject' : 'e.g. Organic Chemistry'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          type="date"
          aria-label="Deadline (optional)"
          title="Exam or deadline (optional)"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={{ width: 150 }}
        />
        <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
          Add
        </Button>
      </form>
    </div>
  )
}
