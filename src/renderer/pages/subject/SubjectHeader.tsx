/**
 * Subject page header: the editable emoji icon (PageHeader's icon button + the emoji picker),
 * the inline-editable title and description, the goals (goal + deadline) and, for a subject Dumbledore suggested, a
 * callout to keep or dismiss it. All edits go through subjects.update; failures show a toast
 * and the read model snaps back.
 */
import { Button, Callout, PageHeader, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import type { SubjectDetail, SubjectPatch } from '@shared/state'
import { Lightbulb } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { EditableText } from './EditableText'
import { EmojiPicker } from './EmojiPicker'
import { SubjectProperties } from './SubjectProperties'

function SuggestedCallout({ subjectId }: { subjectId: string }) {
  const act = useAction('suggested.act')
  const [, navigate] = useLocation()
  const run = (action: 'accept' | 'dismiss') =>
    act.mutate(
      { subjectId, action, intoId: null },
      {
        onSuccess: () => {
          if (action === 'dismiss') {
            toast('Suggestion dismissed')
            navigate('/home')
          } else toast('Added to your subjects', { tone: 'success' })
        },
        onError: (err) => toast(err.message, { tone: 'error' }),
      },
    )
  return (
    <Callout
      icon={<Lightbulb size={18} strokeWidth={1.75} />}
      color="blue"
      className="sp-suggested"
    >
      <div className="sp-suggested__text">
        Dumbledore suggested this subject from what you read. Keep it to get roadmaps, reviews and
        exams for it.
      </div>
      <div className="sp-suggested__actions">
        <Button size="sm" variant="primary" loading={act.isPending} onClick={() => run('accept')}>
          Add to my subjects
        </Button>
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => run('dismiss')}>
          Dismiss
        </Button>
      </div>
    </Callout>
  )
}

export function SubjectHeader({ detail }: { detail: SubjectDetail }) {
  const { subject } = detail
  const update = useAction('subjects.update')
  const iconRef = useRef<HTMLButtonElement>(null)
  const [picking, setPicking] = useState(false)
  const patch = (p: SubjectPatch) =>
    update.mutate(
      { id: subject.id, patch: p },
      { onError: (err) => toast(err.message, { tone: 'error' }) },
    )

  return (
    <>
      <PageHeader
        icon={subject.emoji}
        iconLabel="Change icon"
        iconRef={iconRef}
        iconExpanded={picking}
        onIconClick={() => setPicking((open) => !open)}
        title={
          <EditableText
            value={subject.name}
            label="Subject name"
            placeholder="Untitled"
            className="sp-title"
            onSave={(name) => patch({ name })}
          />
        }
        subtitle={
          <EditableText
            value={subject.description ?? ''}
            label="Description"
            placeholder="Add a description: what this subject is about, in a line or two"
            allowEmpty
            className="sp-description"
            onSave={(description) => patch({ description })}
          />
        }
      >
        <SubjectProperties detail={detail} onPatch={patch} />
        {subject.status === 'suggested' ? <SuggestedCallout subjectId={subject.id} /> : null}
      </PageHeader>
      <EmojiPicker
        anchor={iconRef}
        open={picking}
        onOpenChange={setPicking}
        value={subject.emoji}
        onChange={(emoji) => patch({ emoji })}
      />
    </>
  )
}
