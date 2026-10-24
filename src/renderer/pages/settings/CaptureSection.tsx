/**
 * Settings → Capture & privacy: the capture switch, OCR fallback, cadence, retention,
 * redaction, excluded apps and sites, and live macOS permission status.
 */
import { Switch, Tag } from '@renderer/design-system'
import type { Settings } from '@shared/domain'
import { ExclusionList, hostFromInput } from './ExclusionList'
import { PERMISSIONS, PermissionControl, usePermissionFlow } from './permissions'
import { SelectMenu, type SelectOption, SettingsRow, SettingsSection } from './ui'
import { useCaptureSwitch, useSettingsPatch } from './useSettingsPatch'

const CADENCE: SelectOption<number>[] = [
  { value: 2000, label: 'Every 2 seconds' },
  { value: 4000, label: 'Every 4 seconds' },
  { value: 8000, label: 'Every 8 seconds' },
]

const RETENTION: SelectOption<number>[] = [
  { value: 24, label: '1 day' },
  { value: 48, label: '2 days' },
  { value: 168, label: '1 week' },
]

function PermissionRows() {
  const flow = usePermissionFlow()
  return (
    <>
      {PERMISSIONS.map((p) => (
        <SettingsRow
          key={p.kind}
          label={
            <>
              {p.title}
              <Tag color={p.required ? 'blue' : 'gray'}>{p.required ? 'Required' : 'Optional'}</Tag>
            </>
          }
          description={p.description}
        >
          <PermissionControl
            title={p.title}
            granted={flow.granted(p.kind)}
            waiting={flow.isWaiting(p.kind)}
            onOpen={() => flow.request(p.kind)}
          />
        </SettingsRow>
      ))}
    </>
  )
}

export function CaptureSection({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  const capture = useCaptureSwitch()
  return (
    <>
      <SettingsSection
        title="Capture"
        description="Dumbledore reads the text on your screen to notice what you’re learning. It stays on this Mac."
      >
        <SettingsRow
          label="Screen capture"
          description="Pause any time from the menu bar, the panel or ⌃⌥⌘P."
        >
          <Switch
            label="Screen capture"
            checked={settings.captureEnabled}
            onCheckedChange={(enabled) => capture.mutate(enabled)}
          />
        </SettingsRow>
        <SettingsRow
          label="Read pixels when there’s no text"
          description="Apple’s on-device OCR for slides, scanned PDFs and video. Needs Screen Recording."
        >
          <Switch
            label="Read pixels when there’s no text"
            checked={settings.ocrEnabled}
            onCheckedChange={(ocrEnabled) => patch({ ocrEnabled })}
          />
        </SettingsRow>
        <SettingsRow
          label="How often it looks"
          description="While you’re active. It slows down when you’re idle and stops when the screen locks."
        >
          <SelectMenu
            label="How often it looks"
            value={settings.cadence.activeMs}
            options={CADENCE}
            onChange={(activeMs) => patch({ cadence: { ...settings.cadence, activeMs } })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Privacy"
        description="Password managers, banks, messaging apps, sign-in pages and private windows are always skipped."
      >
        <SettingsRow
          label="Keep screen text for"
          description="After that only what Dumbledore learned from it stays."
        >
          <SelectMenu
            label="Keep screen text for"
            value={settings.privacy.episodeRetentionHours}
            options={RETENTION}
            onChange={(hours) =>
              patch({ privacy: { ...settings.privacy, episodeRetentionHours: hours } })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Redact before sending"
          description="Strips emails, phone numbers, card numbers and passwords before text goes to an AI."
        >
          <Switch
            label="Redact before sending"
            checked={settings.privacy.redact}
            onCheckedChange={(redact) => patch({ privacy: { ...settings.privacy, redact } })}
          />
        </SettingsRow>
        <ExclusionList
          label="Apps it never looks at"
          description="Add an app by its bundle id."
          values={settings.excludedBundleIds}
          placeholder="e.g. com.apple.MobileSMS"
          emptyText="No apps added yet."
          onChange={(excludedBundleIds) => patch({ excludedBundleIds })}
        />
        <ExclusionList
          label="Sites it never looks at"
          description="Paste a link or type a site name."
          values={settings.excludedHosts}
          placeholder="e.g. mail.google.com"
          emptyText="No sites added yet."
          normalize={hostFromInput}
          onChange={(excludedHosts) => patch({ excludedHosts })}
        />
      </SettingsSection>

      <SettingsSection
        title="Permissions"
        description="macOS asks once. Dumbledore notices by itself when you switch them on."
      >
        <PermissionRows />
      </SettingsSection>
    </>
  )
}
