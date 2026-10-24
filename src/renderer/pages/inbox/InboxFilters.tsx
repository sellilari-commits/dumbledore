/**
 * Inbox filters: Notion view tabs for the state (New · Kept · Ignored · All, with the count of
 * new items) and a subject filter on the right (all subjects, one subject, or unfiled).
 */
import { MenuItem, ViewTabs } from '@renderer/design-system'
import type { SubjectSummary } from '@shared/domain'
import { Filter } from 'lucide-react'
import { STATE_TABS, type StateFilter, type SubjectFilter, UNFILED } from './inbox-utils'
import { SubjectMenu } from './SubjectMenu'

export interface InboxFiltersProps {
  state: StateFilter
  subject: SubjectFilter
  newCount: number | undefined
  subjects: SubjectSummary[]
  onState: (state: StateFilter) => void
  onSubject: (subject: SubjectFilter) => void
}

function subjectLabel(subject: SubjectFilter, subjects: SubjectSummary[]): string {
  if (subject === null) return 'All subjects'
  if (subject === UNFILED) return 'Unfiled'
  const s = subjects.find((x) => x.id === subject)
  return s ? `${s.emoji} ${s.name}` : 'All subjects'
}

export function InboxFilters({
  state,
  subject,
  newCount,
  subjects,
  onState,
  onSubject,
}: InboxFiltersProps) {
  const tabs = STATE_TABS.map((t) => ({
    ...t,
    count: t.value === 'new' && newCount ? newCount : undefined,
  }))
  return (
    <ViewTabs
      className="ib-filters"
      label="Show"
      tabs={tabs}
      value={state}
      onChange={onState}
      right={
        <SubjectMenu
          label="Filter by subject"
          subjects={subjects}
          value={subject === UNFILED ? null : subject}
          align="end"
          onPick={onSubject}
          className={subject === null ? undefined : 'ib-select--active'}
          extra={
            <>
              <MenuItem checked={subject === null} onSelect={() => onSubject(null)}>
                All subjects
              </MenuItem>
              <MenuItem checked={subject === UNFILED} onSelect={() => onSubject(UNFILED)}>
                Unfiled
              </MenuItem>
            </>
          }
        >
          <Filter size={13} strokeWidth={1.75} aria-hidden />
          {subjectLabel(subject, subjects)}
        </SubjectMenu>
      }
    />
  )
}
