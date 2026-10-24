/** The settings sections, in nav order: id (route segment), label and nav icon. */
import {
  Bell,
  Bot,
  CircleDot,
  Database,
  Eye,
  Keyboard,
  type LucideIcon,
  Settings2,
  User,
} from 'lucide-react'

export interface SettingsSectionMeta {
  id: SectionId
  label: string
  icon: LucideIcon
}

export type SectionId =
  | 'general'
  | 'capture'
  | 'orb'
  | 'shortcuts'
  | 'ai'
  | 'coaching'
  | 'data'
  | 'about'

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'capture', label: 'Capture & privacy', icon: Eye },
  { id: 'orb', label: 'Orb', icon: CircleDot },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'AI providers', icon: Bot },
  { id: 'coaching', label: 'Coaching', icon: Bell },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'about', label: 'About you', icon: User },
]

export function findSection(id: string | undefined): SettingsSectionMeta | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id)
}
