/**
 * Settings → Shortcuts: the Dumbledore key (with the ⌥-conflict note), the fallback chord,
 * gesture timings, and a reference of in-app and global shortcuts.
 */
import { Button, Callout, Kbd, toast } from '@renderer/design-system'
import type { Settings, TriggerKey } from '@shared/domain'
import { chordKeys, TRIGGER_KEY_ORDER, TRIGGER_KEYS } from './keys'
import { SelectMenu, SettingsRow, SettingsSection } from './ui'
import { useSettingsPatch } from './useSettingsPatch'

type KeyToken = string | { sep: string }

export function Keys({ keys }: { keys: KeyToken[] }) {
  return (
    <span className="dd-set-keys__combo">
      {keys.map((k, i) =>
        typeof k === 'string' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: keys of one chord are positional
          <Kbd boxed key={i}>
            {k}
          </Kbd>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
          <span className="dd-set-keys__sep" key={i} aria-hidden>
            {k.sep}
          </span>
        ),
      )}
    </span>
  )
}

const KEY_GROUPS: Array<{ group: string; items: Array<{ label: string; keys: KeyToken[] }> }> = [
  {
    group: 'In the app',
    items: [
      { label: 'Search', keys: ['⌘', 'K'] },
      { label: 'New subject', keys: ['⌘', 'N'] },
      { label: 'New exam', keys: ['⌘', 'E'] },
      { label: 'Show or hide the sidebar', keys: ['⌘', '\\'] },
      { label: 'Back · Forward', keys: ['⌘', '[', { sep: '/' }, '⌘', ']'] },
      { label: 'Dark mode', keys: ['⌘', '⇧', 'L'] },
      { label: 'Settings', keys: ['⌘', ','] },
      { label: 'Close a dialog', keys: ['Esc'] },
    ],
  },
  {
    group: 'Quiz card',
    items: [
      { label: 'Pick an answer', keys: ['1', { sep: '–' }, '4'] },
      { label: 'Confirm · next question', keys: ['↵'] },
    ],
  },
  {
    group: 'Everywhere',
    items: [
      { label: 'Pause or resume capture', keys: ['⌃', '⌥', '⌘', 'P'] },
      { label: 'Open Dumbledore', keys: ['⌃', '⌥', '⌘', 'D'] },
    ],
  },
]

/** Another app may already own the key; offer a one-click way out. */
export function KeyConflictNote({
  shortcut,
  onResolved,
}: {
  shortcut: Settings['shortcut']
  onResolved?: () => void
}) {
  const { patch } = useSettingsPatch()
  if (shortcut.key !== 'rightOption') return null
  const chord = chordKeys(shortcut.fallbackChord).join('')
  return (
    <Callout icon="🐟" title="Another app may use right ⌥ too">
      <span>
        Goldfish listens to right ⌥, and Claude Desktop to a double-tap of ⌥. If one of them runs
        on this Mac, give Dumbledore another key — {chord} always works.
      </span>
      <div>
        <Button
          size="sm"
          onClick={() => {
            patch({ shortcut: { ...shortcut, key: 'rightCommand' } })
            toast('Dumbledore now listens to right ⌘', { tone: 'success' })
            onResolved?.()
          }}
        >
          Use right ⌘ instead
        </Button>
      </div>
    </Callout>
  )
}

export function ShortcutsSection({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  const s = settings.shortcut
  const options = TRIGGER_KEY_ORDER.map((k) => ({ value: k, label: TRIGGER_KEYS[k].label }))
  return (
    <>
      <SettingsSection
        title="Dumbledore key"
        description="One key does the smart thing wherever you are. Only a clean tap counts, so ⌥2 still types @."
      >
        <SettingsRow
          label="Key"
          description="Tap: next prompt, improve what you typed, or open the panel. Hold or double-tap: Ask bar."
        >
          <SelectMenu<TriggerKey>
            label="Dumbledore key"
            value={s.key}
            options={options}
            onChange={(key) => patch({ shortcut: { ...s, key } })}
          />
        </SettingsRow>
        {s.key === 'rightOption' ? (
          <div className="dd-set-row dd-set-row--stacked">
            <KeyConflictNote shortcut={s} />
          </div>
        ) : null}
        <SettingsRow
          label="Fallback shortcut"
          description="Always works, even when another app owns the key."
        >
          <Keys keys={chordKeys(s.fallbackChord)} />
        </SettingsRow>
        <SettingsRow
          label="Timing"
          description={`A tap is shorter than ${s.tapMaxMs} ms. A hold lasts ${s.holdMinMs} ms. A double-tap lands within ${s.doubleTapMs} ms.`}
        >
          <span className="dd-set-muted">Default</span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title="Keyboard shortcuts"
        description="Notion’s shortcuts in the app, and only two global ones to stay out of other apps’ way."
      >
        {KEY_GROUPS.map((g) => (
          <div key={g.group}>
            <div className="dd-set-keys__group">{g.group}</div>
            <ul className="dd-set-keys" aria-label={g.group}>
              {g.items.map((k) => (
                <li key={k.label} className="dd-set-keyrow">
                  <span>{k.label}</span>
                  <Keys keys={k.keys} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </SettingsSection>
    </>
  )
}
