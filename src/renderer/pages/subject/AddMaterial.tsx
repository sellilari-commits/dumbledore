/**
 * "Add material" on the subject page: main opens a file picker, reads each file and files what
 * it teaches into this subject's memory (materials.add). A toast says what was added, how much
 * (or that only the start of a long file was read) and why a file couldn't be read.
 */
import { Button, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import type { MaterialResult } from '@shared/ipc'
import { Paperclip } from 'lucide-react'

function report(results: MaterialResult[]) {
  for (const r of results) {
    if (!r.ok) {
      toast(`Couldn’t add ${r.name}: ${r.error ?? 'unknown error'}`, { tone: 'error', ttlMs: 8000 })
      continue
    }
    const what = r.notes === 1 ? '1 note' : `${r.notes} notes`
    const part = r.truncated ? ' from the first 30 pages' : ''
    toast(`Added ${r.name}: ${what}${part} in memory`, { tone: 'success', ttlMs: 6000 })
  }
}

export function AddMaterial({ subjectId }: { subjectId: string }) {
  const add = useAction('materials.add', { onSuccess: report, onError: errorToast })
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Paperclip size={14} strokeWidth={1.75} />}
      loading={add.isPending}
      onClick={() => add.mutate({ subjectId })}
    >
      {add.isPending ? 'Reading…' : 'Add material'}
    </Button>
  )
}
