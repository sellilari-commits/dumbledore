/**
 * The app's left rail: traffic-light row (with a hover-only collapse button), the
 * "Dumbledore" workspace row, Search / Home / Inbox / Exams / Settings, the Subjects list
 * (+ New subject) and a capture status row at the bottom.
 */
import {
  IconButton,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  SidebarSection,
  Skeleton,
  SpectaclesGlyph,
  Tooltip,
} from '@renderer/design-system'
import { useAction, useAppState, useInbox, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { ChevronsLeft, FilePenLine, House, Inbox, Plus, Search, Settings } from 'lucide-react'
import { useLocation } from 'wouter'

const ICON = { size: 18, strokeWidth: 1.75 } as const

function SubjectsList({ location }: { location: string }) {
  const subjects = useSubjects()
  const setNewSubject = useShell((s) => s.setNewSubject)
  if (subjects.isLoading)
    return (
      <div style={{ padding: '6px 14px', display: 'grid', gap: 10 }} aria-label="Loading subjects">
        <Skeleton width="70%" />
        <Skeleton width="55%" />
      </div>
    )
  const list = (subjects.data ?? []).filter((s) => s.status !== 'archived')
  return (
    <>
      {list.map((s) => (
        <SidebarItem
          key={s.id}
          icon={<span className="dd-app-sidebar__emoji">{s.emoji}</span>}
          label={s.name}
          href={`/subjects/${s.id}/roadmap`}
          active={location.startsWith(`/subjects/${s.id}`)}
          muted={s.status === 'suggested'}
          meta={s.status === 'suggested' ? 'Suggested' : s.focus === 'focus' ? 'Focus' : undefined}
        />
      ))}
      {subjects.isError ? (
        <SidebarItem muted label="Couldn’t load subjects" onClick={() => subjects.refetch()} />
      ) : null}
      <SidebarItem
        muted
        icon={<Plus {...ICON} />}
        label="New subject"
        onClick={() => setNewSubject(true)}
        title="New subject (⌘N)"
      />
    </>
  )
}

function CaptureStatus() {
  const app = useAppState()
  const setCapture = useAction('capture.setEnabled')
  const on = app.data?.capture.enabled ?? false
  const label = !app.data ? 'Connecting…' : on ? 'Watching your screen' : 'Capture paused'
  return (
    <SidebarItem
      icon={<span className="dd-app-sidebar__status-dot" data-on={on} aria-hidden />}
      label={label}
      muted
      title={on ? 'Pause capture (⌃⌥⌘P)' : 'Resume capture (⌃⌥⌘P)'}
      onClick={() => app.data && setCapture.mutate(!on)}
    />
  )
}

export function AppSidebar({ collapsed }: { collapsed: boolean }) {
  const [location] = useLocation()
  const shell = useShell()
  const inbox = useInbox('new')
  const newCount = inbox.data?.length ?? 0
  return (
    <Sidebar collapsed={collapsed}>
      <div className="dd-app-sidebar__chrome">
        <Tooltip content="Close sidebar" shortcut="⌘\">
          <IconButton label="Close sidebar" className="dd-app-sidebar__collapse" onClick={shell.toggleSidebar}>
            <ChevronsLeft {...ICON} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="dd-app-sidebar__workspace">
        <span className="dd-app-sidebar__mark" aria-hidden>
          <SpectaclesGlyph size={18} strokeWidth={1.9} />
        </span>
        <span>Dumbledore</span>
      </div>
      <div className="dd-sidebar__scroll">
        <SidebarGroup>
          <SidebarItem
            icon={<Search {...ICON} />}
            label="Search"
            meta="⌘K"
            onClick={() => shell.setPalette(true)}
          />
          <SidebarItem icon={<House {...ICON} />} label="Home" href="/home" active={location === '/home'} />
          <SidebarItem
            icon={<Inbox {...ICON} />}
            label="Inbox"
            href="/inbox"
            active={location === '/inbox'}
            badge={newCount}
          />
          <SidebarItem
            icon={<FilePenLine {...ICON} />}
            label="Exams"
            href="/exams"
            active={location.startsWith('/exams')}
          />
          <SidebarItem
            icon={<Settings {...ICON} />}
            label="Settings"
            href="/settings/general"
            active={location.startsWith('/settings')}
          />
        </SidebarGroup>
        <SidebarSection
          title="Subjects"
          action={
            <IconButton label="New subject" size="sm" onClick={() => shell.setNewSubject(true)}>
              <Plus size={14} />
            </IconButton>
          }
        >
          <SubjectsList location={location} />
        </SidebarSection>
      </div>
      <div className="dd-app-sidebar__footer">
        <CaptureStatus />
      </div>
    </Sidebar>
  )
}
