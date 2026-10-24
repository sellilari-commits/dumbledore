/**
 * The shortcut router end to end on the shell harness: gesture → context → decision → effect
 * (text written through the fake helper, windows opened, toasts shown).
 */
import { FakeBrain } from '@engine/testing/fake-brain'
import { describe, expect, it } from 'vitest'
import { makeFocused } from '../fakes/fake-helper'
import { CHAT_FRAME, chatInput, createHarness, flush, inChatGPT, NOTES } from '../testing/harness'

describe('ShortcutRouter', () => {
  it('(c) writes the suggested prompt into an empty AI-chat box, with a coach tip', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    const decision = await h.core.router.gesture('tap')
    expect(decision).toEqual({ kind: 'suggest' })
    expect(h.helper.state.fieldValue).toMatch(/No greetings or small talk/)
    expect(h.helper.callsTo('ax.readFocusedValue')).toHaveLength(1)
    expect(h.helper.callsTo('ax.selectedText')).toHaveLength(0)
    expect(h.core.overlay.state.toasts.map((t) => t.title)).toContain('Why this prompt works')
  })

  it('(c) improves typed text in place', async () => {
    const h = await createHarness()
    await inChatGPT(h, 'what is osmosis')
    expect(await h.core.router.gesture('tap')).toEqual({
      kind: 'improve',
      draft: 'what is osmosis',
    })
    expect(h.helper.state.fieldValue).toMatch(
      /^I'm a student learning this topic\. what is osmosis/,
    )
    const write = h.helper.callsTo('input.write')[0] as { mode: string; expectPid: number }
    expect(write).toMatchObject({ mode: 'replaceAll', expectPid: 501 })
    expect(h.core.overlay.state.toasts[0]?.title).toBe('Prompt improved')
  })

  it('(a) pastes the next roadmap step while a session runs in the chat', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    const orgo = h.services.repos.subjects.findByName('Organic Chemistry')
    await h.core.sessions.start({ subjectId: orgo?.id ?? null, goal: null, question: null })
    expect(h.helper.state.fieldValue).toMatch(/Explain Pass the midterm basics/)
    h.helper.state.fieldValue = ''
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'sessionNext' })
    expect(h.services.study.current()?.index).toBe(1)
    expect(h.helper.state.fieldValue).toMatch(/Pass the midterm mechanism/)
    expect(h.helper.callsTo('ax.readFocusedValue')).toHaveLength(0)
    // The next item is a checkpoint: the side stack shows Quiz, and a tap opens the quiz card.
    expect(h.core.overlay.state.side).toEqual({ next: null, quiz: true })
    await h.core.router.gesture('tap')
    expect(h.core.overlay.state.quiz).not.toBeNull()
    // With the quiz card open, a tap acts as Enter on the overlay.
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'enter', surface: 'overlay' })
    expect(h.surfaces.enters).toEqual(['overlay'])
  })

  it('(b) runs a /d line: "I want to understand X" starts a roadmap and replaces the line', async () => {
    const h = await createHarness()
    await inChatGPT(h, '/d I want to understand recursion')
    const decision = await h.core.router.gesture('tap')
    expect(decision).toEqual({
      kind: 'instruction',
      text: 'I want to understand recursion',
      wholeField: true,
    })
    expect(h.services.study.current()?.title).toMatch(/I want to understand recursion/)
    expect(h.helper.state.fieldValue).not.toContain('/d')
    expect(h.helper.state.fieldValue).toMatch(/Explain/)
  })

  it('(d) offers selection actions; "Explain" without a chat copies the prompt', async () => {
    const h = await createHarness()
    h.helper.activateApp(NOTES)
    await flush()
    h.helper.state.focused = makeFocused(NOTES, { role: 'AXWebArea', editable: false })
    h.helper.state.selection = 'Tertiary carbocations are the most stable'
    expect(await h.core.router.gesture('tap')).toEqual({
      kind: 'selection',
      text: 'Tertiary carbocations are the most stable',
    })
    const toast = h.core.overlay.state.toasts[0]
    expect(toast?.actions.map((a) => a.label)).toEqual([
      'Explain with ChatGPT',
      'Add to a roadmap',
      'Quiz me',
    ])
    await h.core.overlay.toasts.act(toast?.id ?? '', 'explain')
    expect(h.platform.clipboard).toMatch(/Tertiary carbocations are the most stable/)
  })

  it('(d) "Quiz me" reviews the concepts the selection mentions', async () => {
    const h = await createHarness()
    h.helper.state.selection = 'Why is carbocation stability so important for SN1 mechanism?'
    await h.core.router.gesture('tap')
    const toast = h.core.overlay.state.toasts[0]
    await h.core.overlay.toasts.act(toast?.id ?? '', 'quiz')
    const quizId = h.core.overlay.state.quiz?.quizId
    expect(quizId).toBeTruthy()
    expect(h.services.quizzes.get(quizId ?? '').kind).toBe('review')
  })

  it('(e) opens the picker in an AI chat without a session', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    h.helper.state.focused = makeFocused(h.helper.state.frontmost ?? NOTES, {
      role: 'AXWebArea',
      editable: false,
    })
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'picker' })
    expect(h.surfaces.log).toEqual(['open:panel:/picker'])
  })

  it('(f) toggles the mini panel anywhere else', async () => {
    const h = await createHarness()
    await h.core.router.orbClick()
    expect(h.surfaces.isOpen('panel')).toBe(true)
    await h.core.router.orbClick()
    expect(h.surfaces.log).toEqual(['open:panel:/', 'close:panel'])
  })

  it('hold or long-press opens the ask bar over the focused field; tap then acts as Enter', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    expect(await h.core.router.gesture('holdStart')).toEqual({ kind: 'askbar' })
    expect(h.surfaces.lastOptions?.nearField).toEqual(CHAT_FRAME)
    expect(await h.core.router.gesture('holdEnd')).toEqual({ kind: 'ignore' })
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'enter', surface: 'askbar' })
    expect(h.surfaces.enters).toEqual(['askbar'])
  })

  it('refuses password fields without reading them', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    h.helper.state.focused = { ...chatInput(), isSecure: true }
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'refuseSecure' })
    expect(h.helper.callsTo('ax.readFocusedValue')).toHaveLength(0)
    expect(h.core.overlay.state.toasts[0]?.title).toBe('Password field')
  })

  it('Esc cancels pending work and nothing is written', async () => {
    let release: () => void = () => undefined
    const brain = new FakeBrain({
      improvePrompt: () =>
        new Promise((resolve) => {
          release = () => resolve({ prompt: 'Better', coachTip: 'tip' })
        }),
    })
    const h = await createHarness({ brain })
    await inChatGPT(h, 'draft')
    const pending = h.core.router.gesture('tap')
    await flush()
    expect(h.core.pending.busy).toBe(true)
    expect(h.core.router.cancel()).toBe(true)
    release()
    await pending
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
    expect(h.helper.state.fieldValue).toBe('draft')
    expect(h.core.pending.busy).toBe(false)
  })

  it('ignores a second tap while work is pending', async () => {
    let release: () => void = () => undefined
    const brain = new FakeBrain({
      improvePrompt: () =>
        new Promise((resolve) => {
          release = () => resolve({ prompt: 'Better', coachTip: 'tip' })
        }),
    })
    const h = await createHarness({ brain })
    await inChatGPT(h, 'draft')
    const first = h.core.router.gesture('tap')
    await flush()
    await h.core.router.gesture('tap')
    release()
    await first
    expect(h.helper.callsTo('input.write')).toHaveLength(1)
  })

  it('routes helper key.trigger events from the bus', async () => {
    const h = await createHarness()
    h.helper.emit('key.trigger', { gesture: 'doubleTap', key: 'rightOption', secureInput: false })
    await flush()
    expect(h.surfaces.log).toEqual(['open:askbar'])
    h.surfaces.opened.clear()
    h.helper.emit('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: true })
    await flush()
    expect(h.core.overlay.state.toasts.at(-1)?.title).toBe('Password field')
  })
})

describe('Ask flow', () => {
  it('"I don\'t get X" in an AI chat builds a roadmap and pastes step 1', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    h.surfaces.opened.add('askbar')
    const result = await h.core.ask.submit("I don't get the Calvin cycle")
    expect(result.pasted).toBe(true)
    expect(result.actions).toEqual([])
    expect(h.surfaces.log).toContain('close:askbar')
    expect(h.services.study.current()?.phase).toBe('step')
    expect(h.helper.state.fieldValue).toMatch(/Calvin cycle/)
    expect(h.services.repos.chat.history('ask', 10).map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ])
  })

  it('without an AI chat it returns the roadmap action as a chip', async () => {
    const h = await createHarness()
    const result = await h.core.ask.submit('I want to learn recursion')
    expect(result.pasted).toBe(false)
    expect(result.actions[0]?.type).toBe('start_roadmap')
  })
})

describe('Nudges', () => {
  it('accepting a nudge runs its action and records the outcome', async () => {
    const h = await createHarness()
    const concept = h.services.repos.concepts.listStruggling(1)[0]
    const nudge = h.services.repos.nudges.add({
      kind: 'struggle',
      title: 'Quick check?',
      body: 'Carbocations again.',
      action: { type: 'start_review', conceptIds: [concept?.id ?? ''] },
      dedupeKey: 'k1',
    })
    h.services.bus.emit('nudge:ready', { nudge })
    const toast = h.core.overlay.state.toasts.find((t) => t.nudgeId === nudge.id)
    await h.core.overlay.toasts.act(toast?.id ?? '', 'accept')
    await flush()
    expect(h.core.overlay.state.quiz).not.toBeNull()
    const stored = h.services.repos.nudges.listSince('1970-01-01T00:00:00.000Z')[0]
    expect(stored?.outcome).toBe('accepted')
    expect(stored?.shownAt).not.toBeNull()
  })
})
