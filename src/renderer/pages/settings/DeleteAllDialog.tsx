/**
 * "Delete everything?" confirmation for Settings → Data. Lists what goes — including every
 * export in the exports folder, which main deletes with the database, memory files and keys
 * before relaunching the app — and only then calls 'data.deleteAll' with { confirm: true }.
 * If the window survives (the mock never relaunches), the caches are reset and onboarding opens.
 */
import { Button, Dialog, toast } from '@renderer/design-system'
import { useDeleteAllData } from '@renderer/lib/queries'
import { useLocation } from 'wouter'

const GOES = [
  'Your subjects, roadmaps and concepts',
  'Everything Dumbledore saw, and its memory files',
  'Exams, quizzes and the coach chat',
  'Every export in the exports folder',
  'Your settings and saved API keys',
]

export function DeleteAllDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [, navigate] = useLocation()
  const remove = useDeleteAllData({
    onSuccess: () => {
      onOpenChange(false)
      toast('Everything is deleted. Let’s set things up again.', { tone: 'success' })
      navigate('/onboarding')
    },
    onError: (err) => toast(`Couldn’t delete: ${err.message}`, { tone: 'error' }),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
      title="Delete everything?"
      description="This can’t be undone. Dumbledore erases all of this from your Mac, then restarts:"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate({ confirm: true })}
          >
            Delete everything
          </Button>
        </>
      }
    >
      <ul className="dd-set-danger-list">
        {GOES.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
      <p className="dd-set-note">
        Want to keep an export? Move it out of the exports folder first. macOS permissions stay on;
        you can switch them off in System Settings.
      </p>
    </Dialog>
  )
}
