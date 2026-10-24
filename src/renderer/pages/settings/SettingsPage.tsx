/**
 * Settings (`/settings/:section`): Notion's settings layout inside the app — a left section
 * nav and a right column of rows. Sections: General, Capture & privacy, Orb, Shortcuts,
 * AI providers, Coaching, Data, About you. Every section has loading and error states.
 */
import { ErrorState, LoadingState, PageHeader } from '@renderer/design-system'
import { useSettings } from '@renderer/lib/queries'
import type { Settings } from '@shared/domain'
import { Redirect, useParams } from 'wouter'
import { PageFrame } from '../PageFrame'
import { AboutSection } from './AboutSection'
import { AiSection } from './AiSection'
import { CaptureSection } from './CaptureSection'
import { CoachingSection } from './CoachingSection'
import { DataSection } from './DataSection'
import { GeneralSection } from './GeneralSection'
import { OrbSection } from './OrbSection'
import { findSection, type SectionId, SETTINGS_SECTIONS } from './sections'
import { ShortcutsSection } from './ShortcutsSection'
import './settings.css'

function SettingsNav({ active }: { active: SectionId }) {
  return (
    <nav className="dd-set__nav" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          className="dd-set__nav-item"
          href={`#/settings/${id}`}
          aria-current={id === active ? 'page' : undefined}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          {label}
        </a>
      ))}
    </nav>
  )
}

function SectionBody({ id, settings }: { id: SectionId; settings: Settings }) {
  switch (id) {
    case 'general':
      return <GeneralSection settings={settings} />
    case 'capture':
      return <CaptureSection settings={settings} />
    case 'orb':
      return <OrbSection settings={settings} />
    case 'shortcuts':
      return <ShortcutsSection settings={settings} />
    case 'ai':
      return <AiSection settings={settings} />
    case 'coaching':
      return <CoachingSection settings={settings} />
    case 'data':
      return <DataSection />
    case 'about':
      return <AboutSection />
  }
}

export function SettingsPage() {
  const params = useParams<{ section?: string }>()
  const section = findSection(params.section)
  const settings = useSettings()
  if (!section) return <Redirect to="/settings/general" replace />
  return (
    <PageFrame
      crumbs={[{ label: 'Settings', href: '/settings/general' }, { label: section.label }]}
      width="wide"
    >
      <PageHeader compact title="Settings" />
      <div className="dd-set">
        <SettingsNav active={section.id} />
        <div className="dd-set__content">
          {settings.isLoading ? (
            <LoadingState caption="Loading your settings…" lines={6} />
          ) : settings.isError || !settings.data ? (
            <ErrorState
              title="Couldn’t load your settings"
              error={settings.error}
              onRetry={() => settings.refetch()}
            />
          ) : (
            <SectionBody id={section.id} settings={settings.data} />
          )}
        </div>
      </div>
    </PageFrame>
  )
}
