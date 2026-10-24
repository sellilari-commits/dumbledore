/** A learn step is done only once the AI's answer to its prompt is in the chat. */
import type { Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { chat, createHarness, type Harness, ORGO_PLAN, seedSubject } from './test-helpers'

const ANSWER =
  'A leaving group is the part of a molecule that departs with the bonding electron pair. ' +
  'Good leaving groups are weak bases such as iodide, bromide and tosylate, because they can ' +
  'carry the extra negative charge comfortably once they have left.'

function roadmapOf(h: Harness): Roadmap {
  const id = h.service.current()?.roadmapId
  const roadmap = id ? h.repos.roadmaps.get(id) : null
  if (!roadmap) throw new Error('no session roadmap')
  return roadmap
}

/** The chat as perception reports it: the pasted prompt, then (optionally) the AI's answer. */
const excerptWith = (prompt: string, answer: string | null) =>
  [`Student: ${prompt}`, ...(answer ? [`ChatGPT: ${answer}`] : [])].join('\n\n')

async function started(live: { text: string } = { text: '' }) {
  const h = createHarness({
    brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) },
    options: { requireAnswer: true },
    chatExcerpt: () => live.text,
  })
  const subject = seedSubject(h.repos, 'Organic Chemistry')
  const first = await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
  if (first.kind !== 'paste') throw new Error('expected the first step to be pasted')
  return { h, prompt: first.text, live }
}

describe('StudyService — a step is done only after its answer', () => {
  it('a pasted step is sent, not done, and the next tap waits for the answer', async () => {
    const { h, prompt } = await started()
    const next = await h.service.next(chat({ chatExcerpt: excerptWith(prompt, null) }))
    expect(next.kind).toBe('wait')
    expect(roadmapOf(h).items[0]?.status).not.toBe('done')
    expect(h.service.current()?.index).toBe(0)
  })

  it('once the answer is in the chat, the next tap closes the step and hands out the next', async () => {
    const { h, prompt } = await started()
    const next = await h.service.next(chat({ chatExcerpt: excerptWith(prompt, ANSWER) }))
    const r = roadmapOf(h)
    expect(r.items[0]?.status).toBe('done')
    expect(next).toMatchObject({ kind: 'paste', itemId: r.items[1]?.id })
  })

  it('a second tap soon after the wait moves on anyway', async () => {
    const { h, prompt } = await started()
    const ctx = chat({ chatExcerpt: excerptWith(prompt, null) })
    expect((await h.service.next(ctx)).kind).toBe('wait')
    h.clock.advance(3000)
    const second = await h.service.next(ctx)
    expect(second.kind).toBe('paste')
    expect(roadmapOf(h).items[0]?.status).toBe('done')
  })

  it('the watcher marks the step done when a full answer appears in the live chat', async () => {
    const { h, prompt, live } = await started()
    live.text = excerptWith(prompt, 'Thinking…')
    h.clock.advance(10_000)
    expect(roadmapOf(h).items[0]?.status).not.toBe('done')
    live.text = excerptWith(prompt, ANSWER)
    h.clock.advance(10_000)
    expect(roadmapOf(h).items[0]?.status).toBe('done')
  })
})
