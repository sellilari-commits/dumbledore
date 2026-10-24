/**
 * Settings → Data: where everything lives on this Mac. Export and "Delete everything" are
 * shown but disabled — there is no IPC channel for them yet.
 */
import { Button } from '@renderer/design-system'
import { Download } from 'lucide-react'
import { SettingsRow, SettingsSection } from './ui'

const DATA_DIR = '~/Library/Application Support/Dumbledore'

export function DataSection() {
  return (
    <SettingsSection
      title="Your data"
      description="Everything stays on this Mac. There is no account, no sync and no telemetry."
    >
      <SettingsRow
        label="Data folder"
        description={
          <>
            Subjects, what Dumbledore saw, exams and settings.
            <span style={{ display: 'block', marginTop: 6 }}>
              <code className="dd-set-path">{DATA_DIR}</code>
            </span>
          </>
        }
      />
      <SettingsRow
        label="Memory files"
        description={
          <>
            One readable Markdown file per subject, rewritten whenever Dumbledore learns something.
            <span style={{ display: 'block', marginTop: 6 }}>
              <code className="dd-set-path">{DATA_DIR}/memory</code>
            </span>
          </>
        }
      />
      <SettingsRow label="Export everything" description="Coming soon — one zip with your subjects, notes and exams.">
        <Button size="sm" icon={<Download size={14} />} disabled>
          Export
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Delete everything"
        description="Coming soon — erases every subject, capture and key from this Mac."
      >
        <Button size="sm" variant="danger" disabled>
          Delete everything…
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
