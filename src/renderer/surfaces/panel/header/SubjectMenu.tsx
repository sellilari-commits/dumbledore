/**
 * Subject menu in the panel header: shows the subject whose topics are listed and lets the
 * student pick another one (it becomes the focus subject) or go back to following the latest.
 */
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@renderer/design-system'
import { ChevronDown } from 'lucide-react'
import type { PanelSubject } from '../usePanelSubject'

export function SubjectMenu({ panel }: { panel: PanelSubject }) {
  const { subject, focusId, choices, choose } = panel
  if (!subject) return null
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className="pn-subj"
          aria-label={`Subject: ${subject.name}. Change subject`}
        >
          <span className="pn-subj__emoji" aria-hidden>
            {subject.emoji}
          </span>
          <span className="pn-subj__name">{subject.name}</span>
          <ChevronDown size={12} strokeWidth={2} className="pn-subj__chevron" aria-hidden />
        </button>
      }
    >
      <MenuLabel>Show topics of</MenuLabel>
      {choices.map((s) => (
        <MenuItem
          key={s.id}
          icon={s.emoji}
          checked={s.id === focusId}
          onSelect={() => choose(s.id)}
        >
          {s.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem checked={focusId === null} onSelect={() => choose(null)}>
        Follow the latest
      </MenuItem>
    </Menu>
  )
}
