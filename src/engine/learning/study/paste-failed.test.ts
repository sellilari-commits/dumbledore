import type { LearnItem } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { chat, createHarness, ORGO_PLAN, seedSubject } from './test-helpers'

function setup() {
  const h = createHarness({ brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) } })
  const subject = seedSubject(h.repos, 'Organic Chemistry', { emoji: '🧪' })
  const learnAt = (idx: number) => {
    const id = h.service.current()?.roadmapId
    return (id ? h.repos.roadmaps.get(id)?.items[idx] : undefined) as LearnItem | undefined
  }
  const writeCalls = () => h.brain.calls.filter((c) => c.method === 'writeStep').length
  return { h, subject, learnAt, writeCalls }
}

describe('StudyService.pasteFailed (lost step)', () => {
  it('hands out the same prompt again, word for word, instead of advancing', async () => {
    const { h, subject, learnAt, writeCalls } = setup()
    const first = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    if (first.kind !== 'paste') throw new Error('expected a paste')
    expect(learnAt(0)?.promptSent).toBe(first.text)

    h.service.pasteFailed(first.itemId)
    expect(learnAt(0)).toMatchObject({ status: 'current', promptSent: null })
    expect(h.service.current()).toMatchObject({ index: 0, phase: 'step' })

    const again = await h.service.next(chat())
    expect(again).toEqual(first)
    expect(writeCalls()).toBe(1) // no second brain call
    expect(learnAt(0)?.promptSent).toBe(first.text)

    // Confirmed this time: the next tap advances.
    const second = await h.service.next(chat())
    expect(second).toMatchObject({ kind: 'paste', itemId: learnAt(1)?.id })
    expect(learnAt(0)?.status).toBe('done')
  })

  it('survives several failures in a row and ignores unknown or finished items', async () => {
    const { h, subject, learnAt } = setup()
    const first = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    if (first.kind !== 'paste') throw new Error('expected a paste')
    h.service.pasteFailed(first.itemId)
    expect(await h.service.next(chat())).toEqual(first)
    h.service.pasteFailed(first.itemId)
    expect(await h.service.next(chat())).toEqual(first)

    await h.service.next(chat()) // step 1 done, step 2 handed out
    const sessions = h.sessions.length
    h.service.pasteFailed(first.itemId) // finished: ignored
    h.service.pasteFailed('itm_unknown')
    expect(learnAt(0)?.status).toBe('done')
    expect(h.sessions.length).toBe(sessions)
  })

  it('after a restart an undelivered step is written and pasted again', async () => {
    const { h, subject, learnAt } = setup()
    const first = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    if (first.kind !== 'paste') throw new Error('expected a paste')
    h.service.pasteFailed(first.itemId)
    const restarted = h.restart()
    const again = await restarted.next(chat())
    expect(again).toMatchObject({ kind: 'paste', itemId: first.itemId })
    expect(learnAt(0)?.status).not.toBe('done')
  })
})
