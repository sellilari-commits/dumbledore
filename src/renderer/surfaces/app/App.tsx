/**
 * The full app window: providers, hash router, theme sync, the sidebar shell with every page
 * route (PLAN F7), global dialogs (⌘K, ⌘N, ⌘E) and first-run onboarding.
 */
import { ErrorState } from '@renderer/design-system'
import { createQueryClient, Providers } from '@renderer/lib/providers'
import { useSettings } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { useThemeSync } from '@renderer/lib/theme'
import { ExamPage } from '@renderer/pages/exams/ExamPage'
import { ExamsPage } from '@renderer/pages/exams/ExamsPage'
import { NewExamDialog } from '@renderer/pages/exams/NewExamDialog'
import { HomePage } from '@renderer/pages/home/HomePage'
import { InboxPage } from '@renderer/pages/inbox/InboxPage'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { OnboardingPage } from '@renderer/pages/onboarding/OnboardingPage'
import { SettingsPage } from '@renderer/pages/settings/SettingsPage'
import { SubjectPage } from '@renderer/pages/subject/SubjectPage'
import { Component, type ReactNode, useState } from 'react'
import { Redirect, Route, Router, Switch } from 'wouter'
import { navigate, useHashLocation } from 'wouter/use-hash-location'
import { AppCommandMenu } from './AppCommandMenu'
import { AppSidebar } from './AppSidebar'
import { NewSubjectDialog } from './NewSubjectDialog'
import { useAppShortcuts } from './useAppShortcuts'

class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="dd-app__crash">
          <ErrorState
            title="This page hit a snag"
            error={this.state.error}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      )
    return this.props.children
  }
}

function Shell() {
  const collapsed = useShell((s) => s.sidebarCollapsed)
  useAppShortcuts()
  return (
    <div className="dd-app">
      <AppSidebar collapsed={collapsed} />
      <main className="dd-app__main">
        <PageBoundary>
          <Switch>
            <Route path="/home" component={HomePage} />
            <Route path="/inbox" component={InboxPage} />
            <Route path="/exams" component={ExamsPage} />
            <Route path="/exams/:id" component={ExamPage} />
            <Route path="/subjects/:id">{(p) => <Redirect to={`/subjects/${p.id}/roadmap`} replace />}</Route>
            <Route path="/subjects/:id/:view" component={SubjectPage} />
            <Route path="/settings">
              <Redirect to="/settings/general" replace />
            </Route>
            <Route path="/settings/:section" component={SettingsPage} />
            <Route component={NotFoundPage} />
          </Switch>
        </PageBoundary>
      </main>
      <AppCommandMenu />
      <NewSubjectDialog />
      <NewExamDialog />
    </div>
  )
}

function Routes() {
  const settings = useSettings()
  useThemeSync(settings.data?.theme)
  return (
    <Switch>
      <Route path="/">
        {settings.data ? <Redirect to={settings.data.onboardingDone ? '/home' : '/onboarding'} replace /> : null}
      </Route>
      <Route path="/onboarding" component={OnboardingPage} />
      <Route>
        <Shell />
      </Route>
    </Switch>
  )
}

export function App() {
  const [client] = useState(createQueryClient)
  return (
    <Providers client={client} onNavigate={(route) => navigate(route)}>
      <Router hook={useHashLocation}>
        <Routes />
      </Router>
    </Providers>
  )
}
