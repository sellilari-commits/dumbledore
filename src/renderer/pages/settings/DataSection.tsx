/**
 * Settings → Data: where everything lives on this Mac, a JSON export ('data.export' writes it
 * to the exports folder, main reveals it in Finder, and the path is shown here) and "Delete
 * everything" behind a confirmation dialog.
 */
import { Button, toast } from '@renderer/design-system'
import { useExportData } from '@renderer/lib/queries'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { DeleteAllDialog } from './DeleteAllDialog'
import { OkLabel, SettingsRow, SettingsSection } from './ui'

const DATA_DIR = '~/Library/Application Support/Dumbledore'

export function DataSection() {
  const [exportedTo, setExportedTo] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const exportData = useExportData({
    onSuccess: ({ path }) => {
      setExportedTo(path)
      toast('Export saved', { tone: 'success' })
    },
    onError: (err) => toast(`Couldn’t export: ${err.message}`, { tone: 'error' }),
  })
  return (
    <SettingsSection
      title="Your data"
      description="Everything stays on this Mac. There is no account, no sync and no telemetry."
    >
      <SettingsRow
        label="Data folder"
        description={
          <>
            Subjects, what Dumbledore saw, exams, settings and exports.
            <span className="dd-set-status">
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
            <span className="dd-set-status">
              <code className="dd-set-path">{DATA_DIR}/memory</code>
            </span>
          </>
        }
      />
      <SettingsRow
        label="Export everything"
        description={
          <>
            One JSON file with your subjects, concepts, exams and settings, saved in the exports
            folder and shown in Finder. API keys are never included.
            {exportedTo ? (
              <span className="dd-set-result" role="status">
                <OkLabel>Saved to</OkLabel>
                <code className="dd-set-path">{exportedTo}</code>
              </span>
            ) : null}
          </>
        }
      >
        <Button
          size="sm"
          icon={<Download size={14} />}
          loading={exportData.isPending}
          onClick={() => exportData.mutate()}
        >
          Export
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Delete everything"
        description="Erases every subject, capture, exam, export and key from this Mac, then restarts Dumbledore."
      >
        <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
          Delete everything…
        </Button>
      </SettingsRow>
      <DeleteAllDialog open={confirming} onOpenChange={setConfirming} />
    </SettingsSection>
  )
}
