import { FakeClock } from '@engine/clock'
import type { AiChatInfo } from '@engine/contracts'
import { createEngineBus } from '@engine/events'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Nudge } from '@shared/domain'
import type { OverlayState, SessionState } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { chatInput, DISPLAY, SECOND_DISPLAY } from '../testing/harness'
import { HIDE_INTO_EDGE_MS, NUDGE_DOT_MS, OverlayController, RETURN_HOME_MS } from './controller'
import { DOCKED_SIZE, EDGE_INSET, ORB_SIZE } from './geometry'

const CHAT: AiChatInfo = {
  key: 'chatgpt',
  assistant: 'ChatGPT',
  pid: 501,
  bundleId: 'com.google.Chrome',
  url: 'https://chatgpt.com/',
  windowTitle: 'ChatGPT',
}

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    roadmapId: 'rdm_1',
    subjectId: 'sub_1',
    subjectName: 'Organic Chemistry',
    subjectEmoji: '🧪',
    title: 'SN1 vs SN2',
    phase: 'step',
    index: 1,
    total: 5,
    items: [],
    nextAction: 'paste_next',
    assistant: 'ChatGPT',
    startReason: '',
    offerPlacement: false,
    error: null,
    ...over,
  }
}

function setup() {
  const clock = new FakeClock()
  const bus = createEngineBus()
  const repos = createMemoryRepos(clock)
  // Docking beside chat boxes is off by default; these tests cover it switched on.
  repos.settings.update({ orb: { ...repos.settings.get().orb, followChatBoxes: true } })
  let chat: AiChatInfo | null = null
  const states: OverlayState[] = []
  const nudgeChoices: string[] = []
  const controller = new OverlayController({
    bus,
    clock,
    settings: repos.settings,
    study: {
      current: () => null,
      picker: () => ({
        subjects: [
          { subject: {} as never, questions: ['a', 'b'], hasActiveRoadmap: false },
          { subject: {} as never, questions: ['c'], hasActiveRoadmap: true },
        ],
      }),
    },
    perception: { aiChat: () => chat },
    onChange: (s) => states.push(s),
    suggestionPreview: async () =>
      'Explain carbocation stability in 3 numbered points with an example',
    onNudge: (id, choice) => nudgeChoices.push(`${id}:${choice}`),
  })
  controller.setDisplays([DISPLAY])
  controller.start()
  const setChat = (next: AiChatInfo | null) => {
    chat = next
    bus.emit('perception:aiChat', { chat: next })
  }
  return { clock, bus, repos, controller, states, setChat, nudgeChoices }
}

const RIGHT_X = 1512 - EDGE_INSET - ORB_SIZE / 2

describe('OverlayController', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('starts idle at the default home on the primary display', () => {
    const s = t.controller.state
    expect(s.displayId).toBe(1)
    expect(s.orb).toMatchObject({ x: RIGHT_X, size: ORB_SIZE, visual: 'idle', docked: false })
    expect(s.edge).toBe('right')
    expect(s.pill).toBeNull()
    expect(s.side).toEqual({ next: null, quiz: false })
  })

  it('latches a dropped orb to the right edge and saves it as home', () => {
    t.controller.dragOrb(1, 300, 400, false)
    expect(t.controller.state.orb).toMatchObject({ x: 300, y: 400 })
    expect(t.controller.state.edge).toBe('free')
    // The middle of the right edge (where Wispr Flow docks by default) is a valid spot too.
    t.controller.dragOrb(1, 60, 507, true)
    const s = t.controller.state
    const rightX = DISPLAY.workArea.x + DISPLAY.workArea.width - EDGE_INSET - ORB_SIZE / 2
    expect(s.orb).toMatchObject({ x: rightX, y: 507 })
    expect(s.edge).toBe('right')
    expect(t.repos.settings.get().orb.home).toEqual({ displayId: 1, x: rightX, y: 507 })
  })

  it('moves the orb to another display when dropped there, and restores the saved home', () => {
    t.controller.setDisplays([DISPLAY, SECOND_DISPLAY])
    t.controller.dragOrb(1, 1512 + 1900, 500, true)
    expect(t.controller.state.displayId).toBe(2)
    expect(t.controller.state.edge).toBe('right')
    expect(t.repos.settings.get().orb.home?.displayId).toBe(2)
    // Display 2 unplugged → back to the primary; plugged in again → the saved home wins.
    t.controller.setDisplays([DISPLAY])
    expect(t.controller.state.displayId).toBe(1)
    t.controller.setDisplays([DISPLAY, SECOND_DISPLAY])
    expect(t.controller.state.displayId).toBe(2)
  })

  it('docks beside the focused AI-chat input and returns home 1.5 s after focus leaves', () => {
    t.setChat(CHAT)
    t.bus.emit('helper:focus', { app: null, element: chatInput() })
    let s = t.controller.state
    expect(s.orb).toMatchObject({ docked: true, size: DOCKED_SIZE, visual: 'docked' })
    expect(s.orb.x).toBe(400 + 700 + 8 + DOCKED_SIZE / 2)
    expect(s.dockTarget).toEqual({ x: 400, y: 820, width: 700, height: 56 })
    expect(s.chip?.kind).toBe('suggest')

    t.bus.emit('helper:focus', { app: null, element: null })
    t.clock.advance(RETURN_HOME_MS - 100)
    expect(t.controller.state.orb.docked).toBe(true)
    t.clock.advance(200)
    s = t.controller.state
    expect(s.orb).toMatchObject({ docked: false, x: RIGHT_X, size: ORB_SIZE })
    expect(s.chip).toBeNull()
  })

  it('stays docked when focus comes back within the grace period', () => {
    t.setChat(CHAT)
    t.bus.emit('helper:focus', { app: null, element: chatInput() })
    t.bus.emit('helper:focus', { app: null, element: null })
    t.clock.advance(1000)
    t.bus.emit('helper:focus', { app: null, element: chatInput('hi') })
    t.clock.advance(RETURN_HOME_MS * 2)
    expect(t.controller.state.orb.docked).toBe(true)
    expect(t.controller.state.chip).toEqual({ kind: 'improve', text: 'Improve prompt' })
  })

  it('fills the suggestion chip from the prefetched suggestion', async () => {
    t.setChat(CHAT)
    t.bus.emit('helper:focus', { app: null, element: chatInput() })
    await Promise.resolve()
    await Promise.resolve()
    expect(t.controller.state.chip).toEqual({
      kind: 'suggest',
      text: 'Explain carbocation stability in 3 numbered points…',
    })
  })

  it('does not dock to other apps, password fields, or when following is off', () => {
    t.setChat(CHAT)
    t.bus.emit('helper:focus', { app: null, element: { ...chatInput(), pid: 777 } })
    expect(t.controller.state.orb.docked).toBe(false)
    t.bus.emit('helper:focus', { app: null, element: { ...chatInput(), isSecure: true } })
    expect(t.controller.state.orb.docked).toBe(false)
    const settings = t.repos.settings.update({
      orb: { ...t.repos.settings.get().orb, followChatBoxes: false },
    })
    t.bus.emit('settings:changed', { settings })
    t.bus.emit('helper:focus', { app: null, element: chatInput() })
    expect(t.controller.state.orb.docked).toBe(false)
  })

  it('shows the Study pill with the open-question count while an AI chat is open', () => {
    t.setChat(CHAT)
    expect(t.controller.state.pill).toEqual({ label: 'Study', count: 3 })
    expect(t.controller.state.aiChat).toEqual({ provider: 'ChatGPT' })
    t.setChat(null)
    expect(t.controller.state.pill).toBeNull()
  })

  it('shows progress and the side stack during a session, and hides the pill', () => {
    t.setChat(CHAT)
    t.bus.emit('session:changed', { session: session() })
    let s = t.controller.state
    expect(s.orb.visual).toBe('session')
    expect(s.orb.progress).toEqual({ k: 0, n: 5 })
    expect(s.side).toEqual({ next: { label: '3/5' }, quiz: false })
    expect(s.pill).toBeNull()
    t.bus.emit('session:changed', { session: session({ nextAction: 'open_quiz' }) })
    expect(t.controller.state.side).toEqual({ next: null, quiz: true })
    t.bus.emit('session:changed', { session: session({ phase: 'complete', nextAction: 'none' }) })
    s = t.controller.state
    expect(s.side).toEqual({ next: null, quiz: false })
    expect(s.orb.progress).toBeNull()
    expect(s.pill).toEqual({ label: 'Study', count: 3 })
  })

  it('reflects thinking and paused capture', () => {
    t.bus.emit('thinking:changed', { busy: true, label: 'x' })
    expect(t.controller.state.orb).toMatchObject({ thinking: true, visual: 'thinking' })
    t.bus.emit('thinking:changed', { busy: false, label: null })
    const settings = t.repos.settings.update({ captureEnabled: false })
    t.bus.emit('settings:changed', { settings })
    expect(t.controller.state.orb).toMatchObject({ paused: true, visual: 'paused' })
  })

  it('auto-hides toasts after their TTL, paused while hovered', async () => {
    t.controller.showToast({ kind: 'info', title: 'Hi', body: 'there', ttlMs: 1000 })
    expect(t.controller.state.toasts).toHaveLength(1)
    t.clock.advance(600)
    t.controller.hover(true)
    t.clock.advance(5000)
    expect(t.controller.state.toasts).toHaveLength(1)
    t.controller.hover(false)
    t.clock.advance(399)
    expect(t.controller.state.toasts).toHaveLength(1)
    t.clock.advance(2)
    expect(t.controller.state.toasts).toHaveLength(0)
  })

  it('runs toast action callbacks and closes the toast', async () => {
    let ran = 0
    const id = t.controller.showToast({
      kind: 'info',
      title: 'Copy?',
      body: '',
      actions: [{ id: 'copy', label: 'Copy', run: () => void ran++ }],
    })
    expect(await t.controller.toasts.act(id, 'copy')).toBe(true)
    expect(ran).toBe(1)
    expect(t.controller.state.toasts).toHaveLength(0)
  })

  it('collapses an ignored nudge into the orange dot for an hour', () => {
    const nudge: Nudge = {
      id: 'ndg_1',
      kind: 'review_due',
      title: '3-min check?',
      body: 'You missed two yesterday.',
      action: { type: 'start_review', conceptIds: ['con_1'] },
      dedupeKey: 'k',
      createdAt: t.clock.nowIso(),
      shownAt: null,
      outcome: 'pending',
    }
    t.bus.emit('nudge:ready', { nudge })
    const toast = t.controller.state.toasts[0]
    expect(toast).toMatchObject({ kind: 'nudge', nudgeId: 'ndg_1' })
    expect(toast?.actions.map((a) => a.label)).toEqual(['Start review', 'Later'])
    t.clock.advance(15_001)
    expect(t.controller.state.toasts).toHaveLength(0)
    expect(t.controller.state.orb).toMatchObject({ dot: 'orange', visual: 'attention' })
    t.clock.advance(NUDGE_DOT_MS)
    expect(t.controller.state.orb.dot).toBe('none')
  })

  it('hides into the edge when enabled and comes back on hover', () => {
    const settings = t.repos.settings.update({
      orb: { ...t.repos.settings.get().orb, hideIntoEdge: true },
    })
    t.bus.emit('settings:changed', { settings })
    t.clock.advance(HIDE_INTO_EDGE_MS + 1)
    expect(t.controller.state.orb.x).toBeGreaterThan(1512)
    t.controller.hover(true)
    expect(t.controller.state.orb.x).toBe(RIGHT_X)
    t.controller.hover(false)
    t.clock.advance(HIDE_INTO_EDGE_MS + 1)
    expect(t.controller.state.orb.x).toBeGreaterThan(1512)
    t.controller.showToast({ kind: 'info', title: 'Hi', body: '' })
    expect(t.controller.state.orb.x).toBe(RIGHT_X)
  })

  it('opens and closes the quiz card', () => {
    t.controller.openQuiz('quz_1')
    expect(t.controller.state.quiz).toEqual({ quizId: 'quz_1' })
    expect(t.controller.isQuizOpen()).toBe(true)
    t.controller.closeQuiz()
    expect(t.controller.state.quiz).toBeNull()
  })

  it('only emits when the state really changed', () => {
    const before = t.states.length
    t.controller.hover(false)
    t.bus.emit('thinking:changed', { busy: false, label: null })
    expect(t.states.length).toBe(before)
  })

  it('shows no box when a highlight is caught (no "Noted" notification)', () => {
    const t = setup()
    t.bus.emit('perception:highlight', {
      text: 'James Finlayson founded a cotton mill in 1820',
      app: 'Google Chrome',
      title: 'Tampere',
    })
    expect(t.states.at(-1)?.toasts ?? []).toEqual([])
  })
})
