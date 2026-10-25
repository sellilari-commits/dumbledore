/**
 * Earlier versions: the subject's roadmaps that a replan or a new roadmap replaced, kept whole.
 * A quiet toggle under Progress (nothing at all when there are none); each version opens
 * read-only (its steps as they were) and "Bring back" makes it the current roadmap again, which
 * moves the current one in here — so bringing that one back undoes it.
 */
import { Button, ToggleBlock, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatDate } from '@renderer/lib/format'
import { useAction } from '@renderer/lib/queries'
import { useRoadmapHistory } from '@renderer/lib/roadmap-queries'
import type { ItemStatus, RoadmapVersion } from '@shared/domain'
import { useState } from 'react'
import { roadmapProgress } from './subject-utils'

/** A mark per step; "Done" and "Not started" are words for screen readers only. */
const MARK: Record<ItemStatus, { mark: string; word: string; shown: boolean }> = {
  done: { mark: '✓', word: 'Done', shown: false },
  current: { mark: '●', word: 'You were here', shown: true },
  todo: { mark: '○', word: 'Not started', shown: false },
  skipped: { mark: '–', word: 'Skipped', shown: true },
}

function VersionRow({ version }: { version: RoadmapVersion }) {
  const { roadmap } = version
  const [open, setOpen] = useState(false)
  const restore = useAction('roadmaps.restore', {
    onSuccess: () =>
      toast(`Brought back “${roadmap.title}”. The newer one is under Earlier versions.`, {
        tone: 'success',
      }),
    onError: (err) => errorToast(err),
  })
  const p = roadmapProgress(roadmap)
  return (
    <li className="sp-hv">
      <div className="sp-hv__head">
        <span className="sp-hv__date">{formatDate(version.replacedAt)}</span>
        <div className="sp-hv__text">
          <span className="sp-hv__title">{roadmap.title}</span>
          <span className="sp-hv__meta">
            {version.reason ? `${version.reason} · ` : ''}
            {p.done} of {p.total} steps done
          </span>
        </div>
        <div className="sp-hv__actions">
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Open'} ${roadmap.title}`}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide' : 'Open'}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            loading={restore.isPending}
            aria-label={`Bring back ${roadmap.title}`}
            onClick={() => restore.mutate(roadmap.id)}
          >
            Bring back
          </Button>
        </div>
      </div>
      {open ? (
        <ol className="sp-hv__steps" aria-label={`Steps of ${roadmap.title}`}>
          {roadmap.items.map((item) => {
            const s = MARK[item.status]
            return (
              <li key={item.id} className="sp-hv__step" data-status={item.status}>
                <span className="sp-hv__mark" aria-hidden>
                  {s.mark}
                </span>
                <span className="sp-hv__step-title">{item.title}</span>
                <span className={s.shown ? 'sp-hv__word' : 'sp-hv__sr'}>{s.word}</span>
              </li>
            )
          })}
        </ol>
      ) : null}
    </li>
  )
}

export function RoadmapHistory({ subjectId }: { subjectId: string }) {
  const versions = useRoadmapHistory(subjectId).data ?? []
  if (versions.length === 0) return null
  return (
    <ToggleBlock title={`Earlier versions (${versions.length})`} className="sp-history">
      <ul className="sp-history__list" aria-label="Earlier versions">
        {versions.map((v) => (
          <VersionRow key={`${v.roadmap.id}:${v.replacedAt}`} version={v} />
        ))}
      </ul>
    </ToggleBlock>
  )
}
