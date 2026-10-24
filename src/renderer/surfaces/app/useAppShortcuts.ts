/**
 * The app window's Notion shortcuts: ⌘K search · ⌘\ sidebar · ⌘[ / ⌘] back/forward ·
 * ⌘N new subject · ⌘E new exam · ⌘⇧L dark mode · ⌘, settings. (Esc is handled by dialogs.)
 */
import { useHotkeys } from '@renderer/lib/hotkeys'
import { useAction } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { applyTheme, nextTheme } from '@renderer/lib/theme'
import { useLocation } from 'wouter'

export function useAppShortcuts(): void {
  const [, navigate] = useLocation()
  const updateSettings = useAction('settings.update')
  useHotkeys({
    'mod+k': () => {
      const s = useShell.getState()
      s.setPalette(!s.paletteOpen)
    },
    'mod+\\': () => useShell.getState().toggleSidebar(),
    'mod+[': () => window.history.back(),
    'mod+]': () => window.history.forward(),
    'mod+n': () => useShell.getState().setNewSubject(true),
    'mod+e': () => useShell.getState().openNewExam(),
    'mod+shift+l': () => {
      const theme = nextTheme()
      applyTheme(theme)
      updateSettings.mutate({ theme })
    },
    'mod+,': () => navigate('/settings/general'),
  })
}
