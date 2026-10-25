/**
 * "Delete <subject>?" confirmation, opened from the sidebar's trash button and the subject
 * page's top bar. Calls 'subjects.delete' with { confirm: true }; main removes the subject with
 * its concepts, encounters (and their screen text), roadmaps, exams, chat and memory file.
 * Goes home when the deleted subject's page is open.
 */
import { Button, Dialog, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import type { Subject } from '@shared/domain'
import { useLocation } from 'wouter'

export function DeleteSubjectDialog({
  subject,
  onOpenChange,
}: {
  /** The subject to delete; null keeps the dialog closed. */
  subject: Pick<Subject, 'id' | 'name'> | null
  onOpenChange: (open: boolean) => void
}) {
  const [location, navigate] = useLocation()
  const remove = useAction('subjects.delete', {
    onSuccess: (_res, { id }) => {
      onOpenChange(false)
      toast(`${subject?.name ?? 'Subject'} is deleted.`, { tone: 'success' })
      if (location.startsWith(`/subjects/${id}`)) navigate('/home')
    },
    onError: (err) => toast(`Couldn’t delete: ${err.message}`, { tone: 'error' }),
  })
  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
      title={`Delete ${subject?.name ?? 'subject'}?`}
      description="Dumbledore forgets everything about it: topics, what it saw, roadmaps, exams. This can’t be undone."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => subject && remove.mutate({ id: subject.id, confirm: true })}
          >
            Delete
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  )
}
