import type { LearnItem } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, inChatGPT } from '../testing/harness'
import { CHECKPOINT_QUESTION } from './session-flow'

/** The lost-step bug: a step counts as delivered only once its paste is confirmed. */
describe('SessionFlow — failed pastes', () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness()
  })

  const orgoId = () => {
    const orgo = h.services.repos.subjects.findByName('Organic Chemistry')
    if (!orgo) throw new Error('seed subject missing')
    return orgo.id
  }
  const currentItem = () => {
    const s = h.core.services.study.current()
    return s?.items[s.index] as LearnItem | undefined
  }
  const failedToast = () =>
    h.core.overlay.toasts.list().find((t) => t.title.startsWith("Couldn't paste into"))

  it('re-pastes the same step on the next tap after a failed paste, then advances', async () => {
    // No AI chat to write into: the paste fails and the prompt goes to the clipboard.
    const first = await h.core.sessions.start({ subjectId: orgoId(), goal: null, question: null })
    expect(first.instruction.kind).toBe('paste')
    expect(first.write).toMatchObject({ ok: false, method: 'clipboard' })
    const text = first.instruction.kind === 'paste' ? first.instruction.text : ''
    expect(h.platform.clipboard).toBe(text)
    expect(currentItem()).toMatchObject({ status: 'current', promptSent: null })
    expect(h.core.services.study.current()?.index).toBe(0)

    // The chat is there now: the next tap pastes the SAME step, it doesn't skip it.
    await inChatGPT(h)
    const again = await h.core.sessions.next()
    expect(again.write?.ok).toBe(true)
    expect(again.instruction).toMatchObject({
      kind: 'paste',
      itemId: first.instruction.kind === 'paste' ? first.instruction.itemId : '',
    })
    expect(h.core.services.study.current()?.index).toBe(0)
    expect(currentItem()?.promptSent).not.toBeNull()

    // Delivered: the following tap advances.
    const second = await h.core.sessions.next()
    expect(h.core.services.study.current()?.index).toBe(1)
    expect(second.write?.ok).toBe(true)
  })

  it('a failed paste shows no box (the next tap retries it)', async () => {
    await h.core.sessions.start({ subjectId: orgoId(), goal: null, question: null })
    expect(failedToast()).toBeUndefined()
    expect(h.core.overlay.toasts.list()).toEqual([])
  })

  it('a cancelled paste does not count as delivered either', async () => {
    await inChatGPT(h)
    const controller = new AbortController()
    controller.abort()
    const out = await h.core.sessions.start(
      { subjectId: orgoId(), goal: null, question: null },
      { signal: controller.signal },
    )
    expect(out.write).toBeNull()
    expect(currentItem()?.promptSent).toBeNull()
    await h.core.sessions.next()
    expect(h.core.services.study.current()?.index).toBe(0)
    expect(currentItem()?.promptSent).not.toBeNull()
  })
})

describe('SessionFlow — checkpoint: "Do you want to have a quiz or continue?"', () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness()
    await inChatGPT(h)
  })

  const toCheckpoint = async () => {
    const orgo = h.services.repos.subjects.findByName('Organic Chemistry')
    if (!orgo) throw new Error('seed subject missing')
    await h.core.sessions.start({ subjectId: orgo.id, goal: null, question: null })
    await h.core.sessions.next()
    const r = await h.core.sessions.next()
    if (r.instruction.kind !== 'quiz') throw new Error('no checkpoint reached')
    return r.instruction
  }
  const choices = () => h.core.overlay.toasts.list().filter((t) => t.body === CHECKPOINT_QUESTION)
  const choice = () => {
    const [c] = choices()
    if (!c) throw new Error('no checkpoint question')
    return c
  }

  it('asks instead of opening the quiz; Quiz opens the card', async () => {
    const quiz = await toCheckpoint()
    expect(h.core.overlay.state.quiz).toBeNull()
    expect(choice()).toMatchObject({ ttlMs: 0 })
    expect(choice().actions.map((a) => a.label)).toEqual(['Quiz', 'Continue'])
    await h.core.overlay.toasts.act(choice().id, 'quiz')
    expect(h.core.overlay.state.quiz).toEqual({ quizId: quiz.quizId })
    expect(choices()).toEqual([])
  })

  it('Continue skips the checkpoint and pastes the next step', async () => {
    const quiz = await toCheckpoint()
    const writes = h.helper.callsTo('input.write').length
    await h.core.overlay.toasts.act(choice().id, 'continue')
    const session = h.core.services.study.current()
    expect(session?.items.find((i) => i.id === quiz.itemId)?.status).toBe('skipped')
    expect(h.helper.callsTo('input.write')).toHaveLength(writes + 1)
    expect(h.core.overlay.state.quiz).toBeNull()
    expect(choices()).toEqual([])
  })

  it('closing the question leaves the checkpoint; the next tap asks again (once)', async () => {
    await toCheckpoint()
    h.core.overlay.toasts.dismiss(choice().id)
    expect(choices()).toEqual([])
    const again = await h.core.sessions.next()
    expect(again.instruction.kind).toBe('quiz')
    expect(choices()).toHaveLength(1)
    await h.core.sessions.next()
    expect(choices()).toHaveLength(1)
    expect(h.core.overlay.state.quiz).toBeNull()
  })
})

describe('SessionFlow — an early tap while the AI has not answered', () => {
  it('shows exactly one "waiting for the answer" box (it answers the tap)', async () => {
    const h = await createHarness()
    const reason = "Waiting for ChatGPT's answer to this step. Press again to move on anyway."
    await h.core.sessions.perform({ kind: 'wait', reason })
    const toasts = h.core.overlay.toasts.list()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.body).toBe(reason)
  })
})
