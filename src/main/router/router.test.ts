/**
 * The shortcut router end to end on the shell harness: gesture → context → decision → effect
 * (text written through the fake helper, windows opened, toasts shown).
 */
import { FakeBrain } from '@engine/testing/fake-brain'
import { describe, expect, it } from 'vitest'
import { makeFocused } from '../fakes/fake-helper'
import { CHAT_FRAME, chatInput, createHarness, flush, inChatGPT, NOTES } from '../testing/harness'

/** A harness whose taps act at once (no double-tap window); the guard has its own tests. */
async function harness(opts: Parameters<typeof createHarness>[0] = {}) {
  const h = await createHarness(opts)
  const { shortcut } = h.services.repos.settings.get()
  h.services.repos.settings.update({ shortcut: { ...shortcut, doubleTapMs: 0 } })
  return h
}

/** Toast titles, newest last (a launch reminder about Screen Recording may sit among them). */
const titles = (h: Awaited<ReturnType<typeof createHarness>>) =>
  h.core.overlay.state.toasts.map((t) => t.title)

const toastNamed = (h: Awaited<ReturnType<typeof createHarness>>, title: string) =>
  h.core.overlay.state.toasts.find((t) => t.title === title)

/** improvePrompt that waits until `release()` is called. */
function slowImprove() {
  const gate: { release: () => void } = { release: () => undefined }
  const brain = new FakeBrain({
    improvePrompt: () =>
      new Promise((resolve) => {
        gate.release = () => resolve({ prompt: 'Better', coachTip: 'tip' })
      }),
  })
  return { brain, gate }
}

describe('ShortcutRouter', () => {
  it('(c) a tap in an empty AI-chat box studies the subject extracted last', async () => {
    const h = await harness()
    await inChatGPT(h)
    const { repos } = h.services
    const newest = repos.encounters.list({ limit: 50 }).find((e) => e.subjectId !== null)
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'studyLast' })
    expect(h.services.study.current()?.subjectId).toBe(newest?.subjectId)
    expect(h.helper.state.fieldValue).not.toBe('')
    expect(h.surfaces.log).not.toContain('open:panel:/picker')
  })

  it('a tap with no subjects at all opens the picker', async () => {
    const h = await harness({ seed: false })
    await inChatGPT(h)
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'studyLast' })
    expect(h.surfaces.log).toEqual(['open:panel:/picker'])
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
  })

  it('the chip writes the suggested prompt into an empty AI-chat box, with a coach tip', async () => {
    const h = await harness()
    await inChatGPT(h)
    const decision = await h.core.router.chipClick()
    expect(decision).toEqual({ kind: 'suggest' })
    expect(h.helper.state.fieldValue).toMatch(/No greetings or small talk/)
    expect(h.helper.callsTo('ax.readFocusedValue')).toHaveLength(1)
    expect(h.helper.callsTo('ax.selectedText')).toHaveLength(0)
    expect(h.core.overlay.state.toasts.map((t) => t.title)).toContain('Why this prompt works')
  })

  it('(c) a tap on typed text only hints at the hold; nothing is written', async () => {
    const h = await harness()
    await inChatGPT(h, 'what is osmosis')
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'hint', hint: 'holdToRewrite' })
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
    expect(h.helper.state.fieldValue).toBe('what is osmosis')
    expect(titles(h)).toContain('Hold ⌥ to rewrite your prompt')
  })

  it('hold rewrites typed text in place', async () => {
    const h = await harness()
    await inChatGPT(h, 'what is osmosis')
    expect(await h.core.router.gesture('holdStart')).toEqual({
      kind: 'improve',
      draft: 'what is osmosis',
    })
    expect(h.helper.state.fieldValue).toMatch(
      /^I'm a student learning this topic\. what is osmosis/,
    )
    const write = h.helper.callsTo('input.write')[0] as { mode: string; expectPid: number }
    expect(write).toMatchObject({ mode: 'replaceAll', expectPid: 501 })
    expect(titles(h)).toContain('Prompt rewritten')
  })

  it('hold starts thinking at once, and letting go early does not cancel the rewrite', async () => {
    const { brain, gate } = slowImprove()
    const h = await harness({ brain })
    await inChatGPT(h, 'draft')
    const hold = h.core.router.gesture('holdStart')
    await flush()
    expect(h.core.thinking.busy).toBe(true)
    expect(h.core.pending.busy).toBe(true)
    expect(await h.core.router.gesture('holdEnd')).toEqual({ kind: 'ignore' })
    expect(h.core.pending.busy).toBe(true)
    gate.release()
    await hold
    expect(h.helper.state.fieldValue).toBe('Better')
    expect(h.core.thinking.busy).toBe(false)
  })

  it('hold rewrites during a study session too', async () => {
    const h = await harness()
    await inChatGPT(h)
    const orgo = h.services.repos.subjects.findByName('Organic Chemistry')
    await h.core.sessions.start({ subjectId: orgo?.id ?? null, goal: null, question: null })
    h.helper.state.fieldValue = 'why is it unimolecular'
    expect(await h.core.router.gesture('holdStart')).toEqual({
      kind: 'improve',
      draft: 'why is it unimolecular',
    })
    expect(h.services.study.current()?.index).toBe(0)
    expect(h.helper.state.fieldValue).toMatch(/why is it unimolecular/)
  })

  it('hold on an empty chat box, or outside an AI chat, opens the chat with subject choices', async () => {
    const h = await harness()
    await inChatGPT(h)
    expect(await h.core.router.gesture('holdStart')).toEqual({ kind: 'chooseSubject' })
    expect(h.surfaces.log).toEqual(['open:askbar:choose'])
    await h.surfaces.close('askbar')
    h.helper.activateApp(NOTES)
    await flush()
    h.helper.state.focused = makeFocused(NOTES, { role: 'AXWebArea', editable: false })
    expect(await h.core.router.gesture('holdStart')).toEqual({ kind: 'chooseSubject' })
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
    expect(h.services.study.current()).toBeNull()
  })

  it('a chip click rewrites typed text; the orb click only hints', async () => {
    const h = await harness()
    await inChatGPT(h, 'what is osmosis')
    expect(await h.core.router.orbClick()).toEqual({ kind: 'hint', hint: 'holdToRewrite' })
    expect(await h.core.router.chipClick()).toEqual({ kind: 'improve', draft: 'what is osmosis' })
    expect(h.helper.state.fieldValue).toMatch(/what is osmosis/)
    expect(h.helper.callsTo('input.write')).toHaveLength(1)
  })

  it('(a) pastes the next roadmap step while a session runs in the chat', async () => {
    const h = await harness()
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
    const h = await harness()
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
    const h = await harness()
    h.helper.activateApp(NOTES)
    await flush()
    h.helper.state.focused = makeFocused(NOTES, { role: 'AXWebArea', editable: false })
    h.helper.state.selection = 'Tertiary carbocations are the most stable'
    expect(await h.core.router.gesture('tap')).toEqual({
      kind: 'selection',
      text: 'Tertiary carbocations are the most stable',
    })
    const toast = toastNamed(h, 'Selected text')
    expect(toast?.actions.map((a) => a.label)).toEqual([
      'Explain with ChatGPT',
      'Add to a roadmap',
      'Quiz me',
    ])
    await h.core.overlay.toasts.act(toast?.id ?? '', 'explain')
    expect(h.platform.clipboard).toMatch(/Tertiary carbocations are the most stable/)
  })

  it('(d) "Quiz me" reviews the concepts the selection mentions', async () => {
    const h = await harness()
    h.helper.state.selection = 'Why is carbocation stability so important for SN1 mechanism?'
    await h.core.router.gesture('tap')
    const toast = toastNamed(h, 'Selected text')
    await h.core.overlay.toasts.act(toast?.id ?? '', 'quiz')
    const quizId = h.core.overlay.state.quiz?.quizId
    expect(quizId).toBeTruthy()
    expect(h.services.quizzes.get(quizId ?? '').kind).toBe('review')
  })

  it('(e) studies the last subject in an AI chat when the box is not focused', async () => {
    const h = await harness()
    await inChatGPT(h)
    h.helper.state.focused = makeFocused(h.helper.state.frontmost ?? NOTES, {
      role: 'AXWebArea',
      editable: false,
    })
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'studyLast' })
    expect(h.services.study.current()?.phase).toBe('step')
  })

  it('(f) toggles the mini panel anywhere else', async () => {
    const h = await harness()
    await h.core.router.orbClick()
    expect(h.surfaces.isOpen('panel')).toBe(true)
    await h.core.router.orbClick()
    expect(h.surfaces.log).toEqual(['open:panel:/', 'close:panel'])
  })

  it('double-tap opens the chat window over the focused field, then focuses it', async () => {
    const h = await harness()
    await inChatGPT(h)
    expect(await h.core.router.gesture('doubleTap')).toEqual({ kind: 'askbar' })
    expect(h.surfaces.lastOptions?.nearField).toEqual(CHAT_FRAME)
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'enter', surface: 'askbar' })
    expect(h.surfaces.enters).toEqual(['askbar'])
    expect(await h.core.router.gesture('holdStart')).toEqual({ kind: 'ignore' })
    expect(await h.core.router.gesture('doubleTap')).toEqual({ kind: 'focusAskbar' })
    expect(h.surfaces.log).toEqual(['open:askbar', 'open:askbar'])
  })

  it('a long press on the orb opens the chat window', async () => {
    const h = await harness()
    await inChatGPT(h, 'typed text stays as it is')
    expect(await h.core.router.orbLongPress()).toEqual({ kind: 'askbar' })
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
  })

  it('a double-tap supersedes the tap that began it: only the chat window opens', async () => {
    const h = await createHarness()
    await inChatGPT(h)
    const tap = h.core.router.gesture('tap')
    await flush()
    expect(await h.core.router.gesture('doubleTap')).toEqual({ kind: 'askbar' })
    expect(await tap).toEqual({ kind: 'ignore' })
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
    expect(h.helper.state.fieldValue).toBe('')
    expect(h.surfaces.log).toEqual(['open:askbar'])
  })

  it('a lone key tap acts once the double-tap window has passed; clicks act at once', async () => {
    const h = await createHarness()
    const started = Date.now()
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'togglePanel' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(400)
    const clicked = Date.now()
    await h.core.router.orbClick()
    expect(Date.now() - clicked).toBeLessThan(300)
    expect(h.surfaces.log).toEqual(['open:panel:/', 'close:panel'])
  })

  it('refuses password fields without reading them', async () => {
    const h = await harness()
    await inChatGPT(h)
    h.helper.state.focused = { ...chatInput(), isSecure: true }
    expect(await h.core.router.gesture('tap')).toEqual({ kind: 'refuseSecure' })
    expect(h.helper.callsTo('ax.readFocusedValue')).toHaveLength(0)
    expect(titles(h)).toContain('Password field')
  })

  it('Esc cancels pending work and nothing is written', async () => {
    const { brain, gate } = slowImprove()
    const h = await harness({ brain })
    await inChatGPT(h, 'draft')
    const pending = h.core.router.gesture('holdStart')
    await flush()
    expect(h.core.pending.busy).toBe(true)
    expect(h.core.router.cancel()).toBe(true)
    gate.release()
    await pending
    expect(h.helper.callsTo('input.write')).toHaveLength(0)
    expect(h.helper.state.fieldValue).toBe('draft')
    expect(h.core.pending.busy).toBe(false)
  })

  it('ignores a second hold while work is pending', async () => {
    const { brain, gate } = slowImprove()
    const h = await harness({ brain })
    await inChatGPT(h, 'draft')
    const first = h.core.router.gesture('holdStart')
    await flush()
    await h.core.router.gesture('holdStart')
    gate.release()
    await first
    expect(h.helper.callsTo('input.write')).toHaveLength(1)
  })

  it('routes helper key.trigger events from the bus', async () => {
    const h = await harness()
    h.helper.emit('key.trigger', { gesture: 'doubleTap', key: 'rightOption', secureInput: false })
    await flush()
    expect(h.surfaces.log).toEqual(['open:askbar'])
    h.surfaces.opened.clear()
    h.helper.emit('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: true })
    await flush()
    expect(titles(h)).toContain('Password field')
  })

  it('ignores helper key events until onboarding is done', async () => {
    const h = await harness()
    h.services.repos.settings.update({ onboardingDone: false })
    h.helper.emit('key.trigger', { gesture: 'doubleTap', key: 'rightOption', secureInput: false })
    await flush()
    expect(h.surfaces.log).toEqual([])
  })
})

describe('Ask flow', () => {
  it('"I don\'t get X" in an AI chat builds a roadmap and pastes step 1', async () => {
    const h = await harness()
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
    const h = await harness()
    const result = await h.core.ask.submit('I want to learn recursion')
    expect(result.pasted).toBe(false)
    expect(result.actions[0]?.type).toBe('start_roadmap')
  })
})

describe('Nudges', () => {
  it('accepting a nudge runs its action and records the outcome', async () => {
    const h = await harness()
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
