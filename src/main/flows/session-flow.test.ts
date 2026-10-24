import type { LearnItem } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, inChatGPT } from '../testing/harness'

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
