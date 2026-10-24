/**
 * Focus picker (PLAN F9): which subject Dumbledore weighs first. Writes
 * settings.update({ focusSubjectId }) and shows the choice optimistically while it saves.
 */
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@renderer/design-system'
import { useAction, useSettings, useSubjects } from '@renderer/lib/queries'
import type { SettingsPatch } from '@shared/domain'
import { ChevronDown } from 'lucide-react'
import { report } from '../panel-actions'

function pendingFocus(vars: SettingsPatch | undefined): string | null | undefined {
  return vars && 'focusSubjectId' in vars ? (vars.focusSubjectId ?? null) : undefined
}

export function FocusMenu() {
  const settings = useSettings()
  const subjects = useSubjects()
  const update = useAction('settings.update', { onError: report })
  const optimistic = update.isPending ? pendingFocus(update.variables) : undefined
  const focusId = optimistic === undefined ? (settings.data?.focusSubjectId ?? null) : optimistic
  const active = (subjects.data ?? []).filter((s) => s.status === 'active')
  const focus = active.find((s) => s.id === focusId) ?? null
  const choose = (id: string | null) => {
    if (id !== focusId) update.mutate({ focusSubjectId: id })
  }

  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className="pn-focus"
          aria-label={`Focus: ${focus ? focus.name : focusId ? 'loading' : 'none'}. Change focus`}
        >
          <span className="pn-focus__label">Focus</span>
          {focus ? (
            <span className="pn-focus__emoji" aria-hidden>
              {focus.emoji}
            </span>
          ) : null}
          <span className="pn-focus__name">{focus ? focus.name : focusId ? '…' : 'None'}</span>
          <ChevronDown size={12} strokeWidth={2} className="pn-focus__chevron" aria-hidden />
        </button>
      }
    >
      <MenuLabel>Focus on</MenuLabel>
      {active.map((s) => (
        <MenuItem
          key={s.id}
          icon={s.emoji}
          checked={s.id === focusId}
          onSelect={() => choose(s.id)}
        >
          {s.name}
        </MenuItem>
      ))}
      {active.length > 0 ? <MenuSeparator /> : null}
      <MenuItem checked={focusId === null} onSelect={() => choose(null)}>
        No focus
      </MenuItem>
    </Menu>
  )
}
