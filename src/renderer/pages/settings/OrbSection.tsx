/** Settings → Orb: show/hide, follow chat boxes, hide into the edge, reset its position. */
import { Button, Switch, toast } from '@renderer/design-system'
import type { Settings } from '@shared/domain'
import { SettingsRow, SettingsSection } from './ui'
import { useSettingsPatch } from './useSettingsPatch'

export function OrbSection({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  const orb = settings.orb
  return (
    <SettingsSection
      title="Orb"
      description="The small circle on the edge of your screen. It never takes your keyboard focus."
    >
      <SettingsRow
        label="Show the orb"
        description="When it’s hidden, right ⌥ and the menu bar icon still work."
      >
        <Switch
          label="Show the orb"
          checked={orb.visible}
          onCheckedChange={(visible) => patch({ orb: { ...orb, visible } })}
        />
      </SettingsRow>
      <SettingsRow
        label="Follow chat boxes"
        description="Glides next to the AI chat box you click into, with a suggested prompt."
      >
        <Switch
          label="Follow chat boxes"
          checked={orb.followChatBoxes}
          onCheckedChange={(followChatBoxes) => patch({ orb: { ...orb, followChatBoxes } })}
        />
      </SettingsRow>
      <SettingsRow
        label="Hide into the edge"
        description="Tucks away until your pointer comes near."
      >
        <Switch
          label="Hide into the edge"
          checked={orb.hideIntoEdge}
          onCheckedChange={(hideIntoEdge) => patch({ orb: { ...orb, hideIntoEdge } })}
        />
      </SettingsRow>
      <SettingsRow
        label="Position"
        description={
          orb.home
            ? 'You moved it. It remembers its spot on each display.'
            : 'Right edge of the screen, vertically centred.'
        }
      >
        <Button
          size="sm"
          onClick={() => {
            patch({ orb: { ...orb, home: null } })
            toast('The orb is back on the right edge', { tone: 'success' })
          }}
        >
          Reset position
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
