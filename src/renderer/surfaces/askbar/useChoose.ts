/**
 * The Ask bar's "choose" mode (long press of right ⌥ with an empty chat box): main opens the bar
 * with route 'choose' (`#/choose` on the first load, a 'navigate' event after that). It lists the
 * subjects studied most recently (`session.picker`) above the input; picking one starts its
 * session (`session.start`, main pastes the first prompt into the AI chat) and closes the bar.
 * "New topic…" turns the input into a cold start: what the student types becomes the goal.
 * The mode ends when the bar loses focus, so a later plain open shows the chat only.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { PickerData } from '@shared/state'
import { useCallback, useEffect, useState } from 'react'
import { report } from '../overlay/lib/bridge'

export const CHOICE_LIMIT = 5

export interface SubjectChoice {
  id: string
  name: string
  emoji: string
  hint: string
}

export interface ChooseController {
  active: boolean
  choices: SubjectChoice[]
  /** "New topic…" was picked: the input's text starts a cold-start session. */
  newTopic: boolean
  /** Highlighted row: 0…choices.length-1 are subjects, choices.length is "New topic…". */
  highlight: number
  setHighlight: (index: number) => void
  pick: (subjectId: string) => void
  startNewTopic: () => void
  startTopic: (goal: string) => void
  exit: () => void
}

export function isChooseRoute(route: string | null | undefined): boolean {
  return (route ?? '').replace(/^#?\/?/, '').split(/[?#]/)[0] === 'choose'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Most recently studied first (never-studied last), at most CHOICE_LIMIT. */
export function choicesFrom(data: PickerData): SubjectChoice[] {
  const studied = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)
  return [...data.subjects]
    .sort((a, b) => studied(b.subject.lastStudiedAt) - studied(a.subject.lastStudiedAt))
    .slice(0, CHOICE_LIMIT)
    .map(({ subject, questions, hasActiveRoadmap }) => ({
      id: subject.id,
      name: subject.name,
      emoji: subject.emoji,
      hint: hasActiveRoadmap
        ? 'Continue your roadmap'
        : questions.length
          ? plural(questions.length, 'open question')
          : 'Start a roadmap',
    }))
}

export function useChoose(api: DumbledoreApi, close: () => void): ChooseController {
  const [active, setActive] = useState(() => isChooseRoute(window.location.hash))
  const [choices, setChoices] = useState<SubjectChoice[]>([])
  const [newTopic, setNewTopic] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const exit = useCallback(() => {
    setActive(false)
    setNewTopic(false)
  }, [])

  const enter = useCallback((on: boolean) => {
    setActive(on)
    setNewTopic(false)
    setHighlight(0)
  }, [])

  useEffect(() => {
    const onHash = () => enter(isChooseRoute(window.location.hash))
    const off = api.on('navigate', ({ route }) => enter(isChooseRoute(route)))
    window.addEventListener('hashchange', onHash)
    window.addEventListener('blur', exit)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('blur', exit)
    }
  }, [api, enter, exit])

  useEffect(() => {
    if (!active) return
    let live = true
    api
      .invoke('session.picker')
      .then((data) => {
        if (live) setChoices(choicesFrom(data))
      })
      .catch((e: unknown) => report(e, 'session.picker'))
    return () => {
      live = false
    }
  }, [api, active])

  const start = useCallback(
    (subjectId: string | null, goal: string | null) => {
      api
        .invoke('session.start', { subjectId, goal, question: null })
        .catch((e: unknown) => report(e, 'session.start'))
      exit()
      close()
    },
    [api, close, exit],
  )

  const pick = useCallback((subjectId: string) => start(subjectId, null), [start])
  const startTopic = useCallback((goal: string) => start(null, goal), [start])
  const startNewTopic = useCallback(() => setNewTopic(true), [])

  return {
    active,
    choices,
    newTopic,
    highlight,
    setHighlight,
    pick,
    startNewTopic,
    startTopic,
    exit,
  }
}
