/**
 * Top-bar actions of a subject page: "Make a quiz" (the shared New exam dialog with this subject
 * preselected) and a "⋯" menu with Focus (subject.focus + the global focus subject, which
 * together decide what the picker and nudges favour) and Delete subject.
 */
import { Button, IconButton, Menu, MenuItem, MenuSeparator, toast } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { keys, useAction, useSettings } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { SubjectSummary } from '@shared/domain'
import { useQueryClient } from '@tanstack/react-query'
import { Crosshair, Ellipsis, FilePenLine, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DeleteSubjectDialog } from './DeleteSubjectDialog'

function useFocusToggle(subject: SubjectSummary) {
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
  return { on, busy, toggle }
}

/** "⋯" in the top bar: Focus on this subject (checked when on) and Delete subject. */
export function SubjectMenu({ subject }: { subject: SubjectSummary }) {
  const focus = useFocusToggle(subject)
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <Menu
        align="end"
        trigger={
          <IconButton label="More" size="sm">
            <Ellipsis size={16} strokeWidth={2} />
          </IconButton>
        }
      >
        <MenuItem
          icon={<Crosshair size={14} strokeWidth={1.75} />}
          checked={focus.on}
          disabled={focus.busy}
          onSelect={() => void focus.toggle()}
        >
          Focus on this subject
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={14} strokeWidth={1.75} />}
          danger
          onSelect={() => setDeleting(true)}
        >
          Delete subject
        </MenuItem>
      </Menu>
      <DeleteSubjectDialog subject={deleting ? subject : null} onOpenChange={setDeleting} />
    </>
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
      Make a quiz
    </Button>
  )
}
