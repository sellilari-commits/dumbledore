/**
 * PageFrame: what every app page sits in — the 44 px top bar (breadcrumbs + actions, with an
 * "open sidebar" button and traffic-light inset when the sidebar is hidden) and the scrolling
 * page column.
 */
import {
  Breadcrumbs,
  type Crumb,
  IconButton,
  Page,
  Tooltip,
  TopBar,
} from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'

export interface PageFrameProps {
  crumbs: Crumb[]
  actions?: ReactNode
  children: ReactNode
  width?: 'default' | 'wide' | 'full'
}

export function PageFrame({ crumbs, actions, children, width = 'default' }: PageFrameProps) {
  const collapsed = useShell((s) => s.sidebarCollapsed)
  const toggle = useShell((s) => s.toggleSidebar)
  return (
    <>
      <TopBar
        className={collapsed ? 'dd-topbar--inset' : undefined}
        left={
          collapsed ? (
            <Tooltip content="Open sidebar" shortcut="⌘\">
              <IconButton label="Open sidebar" onClick={toggle}>
                <PanelLeftOpen size={18} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          ) : null
        }
        right={actions ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{actions}</div> : null}
      >
        <Breadcrumbs items={crumbs} />
      </TopBar>
      <div className="dd-app__scroll">
        <Page width={width}>{children}</Page>
      </div>
    </>
  )
}
