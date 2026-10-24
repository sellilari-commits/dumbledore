/**
 * Suggested subjects: topics Dumbledore noticed that are not subjects yet. Add one, merge it
 * into an existing subject (its concepts and notes move over), or dismiss it (suggested.act).
 */
import { Button, Section, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import type { SubjectSummary } from '@shared/domain'
import { Check, Sparkles, X } from 'lucide-react'
import { SubjectMenu } from './SubjectMenu'

type Act = 'accept' | 'dismiss' | 'merge'

function SuggestionRow({
  subject,
  targets,
}: {
  subject: SubjectSummary
  targets: SubjectSummary[]
}) {
  const act = useAction('suggested.act')
  const run = (action: Act, into: SubjectSummary | null = null) =>
    act.mutate(
      { subjectId: subject.id, action, intoId: into?.id ?? null },
      {
        onSuccess: () =>
          toast(
            action === 'accept'
              ? `${subject.emoji} ${subject.name} added to your subjects`
              : action === 'merge' && into
                ? `Merged into ${into.emoji} ${into.name}`
                : `Dismissed ${subject.name}`,
            { tone: action === 'dismiss' ? 'info' : 'success' },
          ),
        onError: (err) => toast(err.message, { tone: 'error' }),
      },
    )
  const busy = act.isPending
  return (
    <li className="ib-suggest">
      <span className="ib-suggest__emoji" aria-hidden>
        {subject.emoji}
      </span>
      <div className="ib-suggest__text">
        <div className="ib-suggest__name">{subject.name}</div>
        <div className="ib-suggest__desc">
          {subject.description || 'Dumbledore noticed you reading about this more than once.'}
        </div>
      </div>
      <div className="ib-suggest__actions">
        <Button
          size="sm"
          icon={<Check size={14} />}
          disabled={busy}
          onClick={() => run('accept')}
          aria-label={`Add ${subject.name} as a subject`}
        >
          Add
        </Button>
        <SubjectMenu
          label={`Merge ${subject.name} into another subject`}
          subjects={targets}
          value={null}
          heading="Merge into"
          disabled={busy || targets.length === 0}
          align="end"
          onPick={(id) => run('merge', targets.find((t) => t.id === id) ?? null)}
        >
          Merge
        </SubjectMenu>
        <Button
          size="sm"
          variant="ghost"
          icon={<X size={14} />}
          disabled={busy}
          onClick={() => run('dismiss')}
          aria-label={`Dismiss ${subject.name}`}
        >
          Dismiss
        </Button>
      </div>
    </li>
  )
}

export function SuggestedSubjects({ subjects }: { subjects: SubjectSummary[] }) {
  const suggested = subjects.filter((s) => s.status === 'suggested')
  const targets = subjects.filter((s) => s.status === 'active')
  if (suggested.length === 0) return null
  return (
    <Section
      id="inbox-suggested"
      title="Suggested subjects"
      icon={<Sparkles size={14} strokeWidth={1.75} />}
    >
      <ul className="ib-suggest-list">
        {suggested.map((s) => (
          <SuggestionRow key={s.id} subject={s} targets={targets} />
        ))}
      </ul>
    </Section>
  )
}
