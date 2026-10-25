/**
 * ⌘K for the app: jump to pages and subjects, run actions (new subject/exam, theme, capture),
 * and search everything Dumbledore knows through 'search.query'.
 */
import { CommandPalette, filterItems, type PaletteItem } from '@renderer/design-system'
import { useAction, useAppState, useSearch, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { applyTheme, nextTheme } from '@renderer/lib/theme'
import type { SearchHit } from '@shared/state'
import { Brain, Eye, FilePenLine, House, Moon, Pause, Play, Plus, Settings } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useLocation } from 'wouter'

const ICON = { size: 16, strokeWidth: 1.75 } as const

const HIT_GROUP: Record<SearchHit['kind'], string> = {
  subject: 'Subjects',
  concept: 'Topics',
  encounter: 'Seen on screen',
  exam: 'Exams',
}

const HIT_ICON: Record<SearchHit['kind'], React.ReactNode> = {
  subject: null,
  concept: <Brain {...ICON} />,
  encounter: <Eye {...ICON} />,
  exam: <FilePenLine {...ICON} />,
}

export function AppCommandMenu() {
  const open = useShell((s) => s.paletteOpen)
  const shell = useShell()
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const search = useSearch(deferred)
  const subjects = useSubjects()
  const app = useAppState()
  const updateSettings = useAction('settings.update')
  const setCapture = useAction('capture.setEnabled')
  const captureOn = app.data?.capture.enabled ?? true

  const go = (route: string) => () => navigate(route)
  const statics: PaletteItem[] = [
    {
      id: 'go-home',
      group: 'Jump to',
      title: 'Home',
      icon: <House {...ICON} />,
      onSelect: go('/home'),
    },
    {
      id: 'go-inbox',
      group: 'Jump to',
      title: 'Memory',
      subtitle: 'What Dumbledore knows',
      icon: <Brain {...ICON} />,
      onSelect: go('/inbox'),
    },
    {
      id: 'go-exams',
      group: 'Jump to',
      title: 'Exams',
      icon: <FilePenLine {...ICON} />,
      onSelect: go('/exams'),
    },
    {
      id: 'go-settings',
      group: 'Jump to',
      title: 'Settings',
      icon: <Settings {...ICON} />,
      shortcut: '⌘,',
      onSelect: go('/settings/general'),
    },
    ...(subjects.data ?? [])
      .filter((s) => s.status !== 'archived')
      .map((s) => ({
        id: `subject-${s.id}`,
        group: 'Jump to',
        title: s.name,
        icon: <span>{s.emoji}</span>,
        onSelect: go(`/subjects/${s.id}/roadmap`),
      })),
    {
      id: 'new-subject',
      group: 'Actions',
      title: 'New subject',
      icon: <Plus {...ICON} />,
      shortcut: '⌘N',
      onSelect: () => shell.setNewSubject(true),
    },
    {
      id: 'new-exam',
      group: 'Actions',
      title: 'New exam',
      icon: <FilePenLine {...ICON} />,
      shortcut: '⌘E',
      keywords: ['quiz', 'test'],
      onSelect: () => shell.openNewExam(),
    },
    {
      id: 'theme',
      group: 'Actions',
      title: 'Toggle dark mode',
      icon: <Moon {...ICON} />,
      shortcut: '⌘⇧L',
      keywords: ['theme', 'light'],
      onSelect: () => {
        const t = nextTheme()
        applyTheme(t)
        updateSettings.mutate({ theme: t })
      },
    },
    {
      id: 'capture',
      group: 'Actions',
      title: captureOn ? 'Pause capture' : 'Resume capture',
      icon: captureOn ? <Pause {...ICON} /> : <Play {...ICON} />,
      shortcut: '⌃⌥⌘P',
      keywords: ['privacy', 'screen', 'ocr'],
      onSelect: () => setCapture.mutate(!captureOn),
    },
  ]

  const hits: PaletteItem[] = query.trim()
    ? (search.data ?? []).map((h) => ({
        id: `hit-${h.kind}-${h.id}`,
        group: HIT_GROUP[h.kind],
        title: h.title,
        subtitle: h.snippet,
        icon: HIT_ICON[h.kind],
        onSelect: go(h.route),
      }))
    : []

  const items = [...hits, ...filterItems(statics, query)]
  return (
    <CommandPalette
      open={open}
      onOpenChange={(o) => {
        shell.setPalette(o)
        if (!o) setQuery('')
      }}
      query={query}
      onQueryChange={setQuery}
      items={items}
      loading={search.isFetching && query.trim().length > 0}
    />
  )
}
