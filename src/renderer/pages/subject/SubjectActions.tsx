/**
 * Top-bar actions of a subject page: the Focus toggle (subject.focus + the global focus subject,
 * which together decide what the picker and nudges favour) and "Generate exam" (the shared
 * New exam dialog with this subject preselected).
 */
import { Button, Tooltip, toast } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { keys, useAction, useSettings } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { SubjectSummary } from '@shared/domain'
import { useQueryClient } from '@tanstack/react-query'
import { Crosshair, FilePenLine } from 'lucide-react'

export function FocusToggle({ subject }: { subject: SubjectSummary }) {
  const qc = useQueryClient()
  const settings = useSettings()
  const update = useAction('subjects.update')
  const runAction = useAction('coach.runAction')
  const globalFocus = settings.data?.focusSubjectId === subject.id
  const on = subject.focus === 'focus' || globalFocus
  const busy = update.isPending || runAction.isPending

  const toggle = async () => {
    try {
      await update.mutateAsync({ id: subject.id, patch: { focus: on ? 'normal' : 'focus' } })
      // Read settings at click time: the toggle can be clicked before they first load.
      const current = await qc.fetchQuery({
        queryKey: keys.settings(),
        queryFn: () => invoke('settings.get'),
      })
      if (!on) await runAction.mutateAsync({ type: 'set_focus', subjectId: subject.id })
      else if (current.focusSubjectId === subject.id)
        await runAction.mutateAsync({ type: 'set_focus', subjectId: null })
      toast(on ? 'Focus off' : `Focusing on ${subject.name}`, { tone: on ? 'info' : 'success' })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t change focus.', { tone: 'error' })
    }
  }

  return (
    <Tooltip
      content={on ? 'Focused' : 'Focus on this subject'}
      sub="Suggestions, reviews and nudges favour it"
    >
      <Button
        size="sm"
        variant="ghost"
        className="sp-focus"
        data-on={on}
        aria-pressed={on}
        disabled={busy}
        icon={<Crosshair size={14} strokeWidth={2} />}
        onClick={() => void toggle()}
      >
        {on ? 'Focused' : 'Focus'}
      </Button>
    </Tooltip>
  )
}

export function GenerateExamButton({ subjectId }: { subjectId: string }) {
  const openNewExam = useShell((s) => s.openNewExam)
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<FilePenLine size={14} strokeWidth={2} />}
      onClick={() => openNewExam([subjectId])}
    >
      Generate exam
    </Button>
  )
}
