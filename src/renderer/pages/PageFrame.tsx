/**
 * PageFrame: what every app page sits in — the 44 px top bar (back / forward, breadcrumbs and
 * actions, with an "open sidebar" button and traffic-light inset when the sidebar is hidden)
 * and the scrolling page column.
 */
import { Breadcrumbs, type Crumb, IconButton, Page, Tooltip, TopBar } from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { ArrowLeft, ArrowRight, PanelLeftOpen } from 'lucide-react'
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
          <div className="dd-topbar__nav">
            {collapsed ? (
              <Tooltip content="Open sidebar" shortcut="⌘\">
                <IconButton label="Open sidebar" onClick={toggle}>
                  <PanelLeftOpen size={18} strokeWidth={1.75} />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip content="Back" shortcut="⌘[">
              <IconButton label="Back" onClick={() => window.history.back()}>
                <ArrowLeft size={18} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Forward" shortcut="⌘]">
              <IconButton label="Forward" onClick={() => window.history.forward()}>
                <ArrowRight size={18} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </div>
        }
        right={
          actions ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{actions}</div>
          ) : null
        }
      >
        <Breadcrumbs items={crumbs} />
      </TopBar>
      <div className="dd-app__scroll">
        <Page width={width}>{children}</Page>
      </div>
    </>
  )
}
