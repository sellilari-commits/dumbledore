/**
 * Concepts view: every concept of the subject as a Notion table — name, status tag (+ "Due"),
 * mastery bar, last seen, next review — sorted by the view's Sort menu (ConceptSortMenu, shown
 * in the view-tab bar).
 */
import {
  Button,
  type Column,
  DatabaseTable,
  EmptyState,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  ProgressBar,
  Tag,
} from '@renderer/design-system'
import { daysUntil, formatDue, formatPercent, formatRelative } from '@renderer/lib/format'
import { DUE, MASTERY } from '@renderer/lib/status'
import type { Concept, MasteryStatus } from '@shared/domain'
import {
  ALargeSmall,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarClock,
  CircleChevronDown,
  Clock,
  Gauge,
} from 'lucide-react'
import {
  type ConceptSort,
  type ConceptSortKey,
  DEFAULT_DIR,
  isDue,
  SORT_LABEL,
  sortConcepts,
} from './subject-utils'

const HEAD = { size: 14, strokeWidth: 1.75 } as const
const SORT_KEYS = Object.keys(SORT_LABEL) as ConceptSortKey[]
/** Mastery bars take the status colour (PLAN §3.2: colour carries meaning). */
const BAR: Record<MasteryStatus, 'gray' | 'yellow' | 'red' | 'green'> = {
  new: 'gray',
  learning: 'yellow',
  struggling: 'red',
  mastered: 'green',
}

function NextReview({ concept }: { concept: Concept }) {
  if (!concept.nextReviewAt) return <span className="dd-table__muted">—</span>
  const days = daysUntil(concept.nextReviewAt)
  if (days <= 0) return <span className="sp-due">{days < 0 ? 'Overdue' : 'Today'}</span>
  return <span>{formatDue(concept.nextReviewAt)}</span>
}

const COLUMNS: Column<Concept>[] = [
  {
    key: 'name',
    header: 'Name',
    icon: <ALargeSmall {...HEAD} />,
    render: (c) => (
      <span className="dd-table__title-cell" title={c.summary}>
        <span>{c.name}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    icon: <CircleChevronDown {...HEAD} />,
    width: 168,
    render: (c) => (
      <span className="sp-tags">
        <Tag color={MASTERY[c.status].color} dot>
          {MASTERY[c.status].label}
        </Tag>
        {isDue(c) ? <Tag color={DUE.color}>Due</Tag> : null}
      </span>
    ),
  },
  {
    key: 'mastery',
    header: 'Mastery',
    icon: <Gauge {...HEAD} />,
    width: 132,
    render: (c) => (
      <span className="sp-mastery">
        <ProgressBar
          value={c.mastery}
          width={56}
          color={BAR[c.status]}
          label={`${c.name} mastery`}
        />
        <span className="dd-table__num">{formatPercent(c.mastery)}</span>
      </span>
    ),
  },
  {
    key: 'lastSeen',
    header: 'Last seen',
    icon: <Clock {...HEAD} />,
    width: 116,
    render: (c) => <span className="dd-table__muted">{formatRelative(c.lastSeenAt)}</span>,
  },
  {
    key: 'nextReview',
    header: 'Next review',
    icon: <CalendarClock {...HEAD} />,
    width: 124,
    render: (c) => <NextReview concept={c} />,
  },
]

/** Notion's "Sort" control for the view-tab bar: a property, then a direction. */
export function ConceptSortMenu({
  sort,
  onChange,
}: {
  sort: ConceptSort
  onChange: (sort: ConceptSort) => void
}) {
  const Icon = sort.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow
  return (
    <Menu
      align="end"
      trigger={
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon size={14} />}
          aria-label={`Sort concepts: ${SORT_LABEL[sort.key]}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
        >
          {SORT_LABEL[sort.key]}
        </Button>
      }
    >
      <MenuLabel>Sort by</MenuLabel>
      {SORT_KEYS.map((key) => (
        <MenuItem
          key={key}
          checked={sort.key === key}
          onSelect={() => onChange({ key, dir: sort.key === key ? sort.dir : DEFAULT_DIR[key] })}
        >
          {SORT_LABEL[key]}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem checked={sort.dir === 'asc'} onSelect={() => onChange({ ...sort, dir: 'asc' })}>
        Ascending
      </MenuItem>
      <MenuItem checked={sort.dir === 'desc'} onSelect={() => onChange({ ...sort, dir: 'desc' })}>
        Descending
      </MenuItem>
    </Menu>
  )
}

export function ConceptsView({ concepts, sort }: { concepts: Concept[]; sort: ConceptSort }) {
  if (concepts.length === 0)
    return (
      <EmptyState icon="🧩" title="No concepts yet">
        Dumbledore adds concepts as you read, watch and chat about this subject — each with a
        mastery score and a review date.
      </EmptyState>
    )
  return (
    <DatabaseTable
      label="Concepts"
      columns={COLUMNS}
      rows={sortConcepts(concepts, sort)}
      rowKey={(c) => c.id}
    />
  )
}
