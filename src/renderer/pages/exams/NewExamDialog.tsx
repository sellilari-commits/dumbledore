/**
 * New exam (⌘E, global): pick subjects, 5 / 10 / 20 questions, a focus (weak spots, due
 * reviews, everything) and a difficulty — then 'exams.create' and open the exam page.
 * Opened through useShell().openNewExam(subjectIds?).
 */
import { Button, Choices, Dialog, RadioGroup, RadioRow } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction, useSettings, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { ExamSpec, SubjectSummary } from '@shared/domain'
import { Check } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { minutesFor } from './exam-utils'
import './exams.css'

type Count = ExamSpec['count']
type Focus = ExamSpec['focus']
type Difficulty = ExamSpec['difficulty']

const COUNTS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
] as const satisfies ReadonlyArray<{ value: Count; label: string }>

const DIFFICULTIES = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'easy', label: 'Easy' },
  { value: 'hard', label: 'Hard' },
] as const satisfies ReadonlyArray<{ value: Difficulty; label: string }>

const FOCUSES: ReadonlyArray<{ value: Focus; label: string; hint: string }> = [
  { value: 'weak', label: 'Weak spots', hint: 'Topics you missed or rarely got right' },
  { value: 'due', label: 'Due for review', hint: 'Spaced reviews that are due today' },
  { value: 'everything', label: 'Everything', hint: 'A mix across the whole subject' },
]

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ex-field">
      <div className="ex-field__label">{label}</div>
      {children}
    </div>
  )
}

function SubjectRow({
  subject,
  checked,
  onToggle,
}: {
  subject: SubjectSummary
  checked: boolean
  onToggle: () => void
}) {
  const meta =
    subject.dueReviews > 0
      ? `${subject.dueReviews} due`
      : `${Math.round(subject.mastery * 100)}% mastered`
  return (
    <label className="ex-subject-row">
      <input type="checkbox" className="dd-sr-only" checked={checked} onChange={onToggle} />
      <span className="ex-check" data-checked={checked} aria-hidden>
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="ex-subject-row__emoji" aria-hidden>
        {subject.emoji}
      </span>
      <span className="ex-subject-row__name">{subject.name}</span>
      <span className="ex-subject-row__meta">{meta}</span>
    </label>
  )
}

export function NewExamDialog() {
  const { open, subjectIds } = useShell((s) => s.newExam)
  const closeNewExam = useShell((s) => s.closeNewExam)
  const subjects = useSubjects()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const [selected, setSelected] = useState<string[]>([])
  const [count, setCount] = useState<Count>(10)
  const [focus, setFocus] = useState<Focus>('weak')
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed')
  const create = useAction('exams.create')

  const active = (subjects.data ?? []).filter((s) => s.status === 'active')
  const initialised = useRef(false)

  // Choose the starting subjects once per opening, as soon as the subject list is known.
  useEffect(() => {
    if (!open) {
      initialised.current = false
      return
    }
    // Wait for settings too, so the focus subject wins over "first in the list".
    if (initialised.current || !subjects.data || settings.isLoading) return
    const activeIds = subjects.data.filter((s) => s.status === 'active').map((s) => s.id)
    const preset = subjectIds.filter((id) => activeIds.includes(id))
    const focusId = settings.data?.focusSubjectId
    const first =
      preset.length > 0
        ? preset
        : focusId && activeIds.includes(focusId)
          ? [focusId]
          : activeIds.slice(0, 1)
    setSelected(first)
    initialised.current = true
  }, [open, subjectIds, subjects.data, settings.isLoading, settings.data?.focusSubjectId])

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const submit = () => {
    const ids = active.map((s) => s.id).filter((id) => selected.includes(id))
    if (ids.length === 0) return
    create.mutate(
      { subjectIds: ids, count, focus, difficulty },
      {
        onSuccess: (quiz) => {
          closeNewExam()
          navigate(`/exams/${quiz.id}`)
        },
        onError: (err) => errorToast(err),
      },
    )
  }

  const canCreate = selected.some((id) => active.some((s) => s.id === id))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeNewExam()
      }}
      title="New exam"
      description="Two clicks: pick what to cover, Dumbledore writes it."
      footer={
        <>
          <span className="dd-dialog__footer-note">About {minutesFor(count)} min</span>
          <Button variant="ghost" onClick={closeNewExam}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canCreate}
            loading={create.isPending}
          >
            Create exam
          </Button>
        </>
      }
    >
      <FieldBlock label="Subjects">
        {subjects.isLoading ? (
          <div className="ex-field__label">Loading your subjects…</div>
        ) : active.length === 0 ? (
          <div className="ex-field__label">Add a subject first — exams are written from it.</div>
        ) : (
          <fieldset className="ex-subject-list">
            <legend className="dd-sr-only">Subjects</legend>
            {active.map((s) => (
              <SubjectRow
                key={s.id}
                subject={s}
                checked={selected.includes(s.id)}
                onToggle={() => toggle(s.id)}
              />
            ))}
          </fieldset>
        )}
      </FieldBlock>
      <div className="ex-field__row">
        <FieldBlock label="Questions">
          <Choices label="Questions" value={count} options={COUNTS} onChange={setCount} />
        </FieldBlock>
        <FieldBlock label="Difficulty">
          <Choices
            label="Difficulty"
            value={difficulty}
            options={DIFFICULTIES}
            onChange={setDifficulty}
          />
        </FieldBlock>
      </div>
      <FieldBlock label="Focus">
        <RadioGroup label="Focus">
          {FOCUSES.map((f) => (
            <RadioRow
              key={f.value}
              checked={focus === f.value}
              hint={f.hint}
              onSelect={() => setFocus(f.value)}
            >
              {f.label}
            </RadioRow>
          ))}
        </RadioGroup>
      </FieldBlock>
    </Dialog>
  )
}
