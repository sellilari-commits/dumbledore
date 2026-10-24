/** Settings → Coaching: how many nudges, how far apart, quiet hours, morning plan, evening wrap. */
import { Input, Switch } from '@renderer/design-system'
import type { Settings } from '@shared/domain'
import { SelectMenu, type SelectOption, SettingsRow, SettingsSection } from './ui'
import { useSettingsPatch } from './useSettingsPatch'

const PER_DAY: SelectOption<number>[] = [0, 1, 2, 3, 4, 5, 6].map((n) => ({
  value: n,
  label: n === 0 ? 'Off' : `${n} a day`,
}))

const GAPS: SelectOption<number>[] = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
]

const DEFAULT_QUIET = { start: '22:30', end: '08:00' }

export function CoachingSection({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  const c = settings.coaching
  const set = (next: Partial<Settings['coaching']>) => patch({ coaching: { ...c, ...next } })
  return (
    <SettingsSection
      title="Coaching"
      description="Dumbledore speaks up only at natural breaks — never while you type, in full-screen video or in meetings."
    >
      <SettingsRow label="Nudges" description="At most this many suggestions a day.">
        <SelectMenu
          label="Nudges per day"
          value={c.nudgesPerDay}
          options={PER_DAY}
          onChange={(nudgesPerDay) => set({ nudgesPerDay })}
        />
      </SettingsRow>
      <SettingsRow label="Time between nudges" description="The shortest gap between two of them.">
        <SelectMenu
          label="Time between nudges"
          value={c.minGapMinutes}
          options={GAPS}
          onChange={(minGapMinutes) => set({ minGapMinutes })}
        />
      </SettingsRow>
      <SettingsRow label="Quiet hours" description="No nudges at all in this window.">
        {c.quietHours ? (
          <>
            <Input
              type="time"
              aria-label="Quiet hours start"
              value={c.quietHours.start}
              onChange={(e) =>
                c.quietHours && set({ quietHours: { ...c.quietHours, start: e.target.value } })
              }
              style={{ width: 104 }}
            />
            <span className="dd-set-muted">to</span>
            <Input
              type="time"
              aria-label="Quiet hours end"
              value={c.quietHours.end}
              onChange={(e) =>
                c.quietHours && set({ quietHours: { ...c.quietHours, end: e.target.value } })
              }
              style={{ width: 104 }}
            />
          </>
        ) : null}
        <Switch
          label="Quiet hours"
          checked={c.quietHours !== null}
          onCheckedChange={(on) => set({ quietHours: on ? DEFAULT_QUIET : null })}
        />
      </SettingsRow>
      <SettingsRow
        label="Morning plan"
        description="When you start your day: what’s due, and a plan that fits your time."
      >
        <Switch
          label="Morning plan"
          checked={c.morningPlan}
          onCheckedChange={(morningPlan) => set({ morningPlan })}
        />
      </SettingsRow>
      <SettingsRow label="Evening wrap" description="What you learned today and what comes back tomorrow.">
        <Switch
          label="Evening wrap"
          checked={c.eveningWrap}
          onCheckedChange={(eveningWrap) => set({ eveningWrap })}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
