/**
 * Real engine across an app restart: compose again on the same data folder and the subjects,
 * the roadmap with its progress, checkpoint results, mastery and the Inbox are all back; the
 * session resumes where it stopped.
 */
import type { ChatContext } from '@engine/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { CHATGPT, createRig, disposeRig, MINUTE, NOTES, type Rig, runFor, WIKI } from './test-kit'

const ctx = (rig: Rig): ChatContext => ({
  assistant: 'ChatGPT',
  chatExcerpt: rig.services.perception.chatExcerpt(1500),
  pageContext: '',
})

describe('composeReal: restart', () => {
  const rigs: Rig[] = []
  afterEach(async () => {
    for (const rig of rigs.splice(0).reverse()) await disposeRig(rig)
  })

  it('restores subjects, the roadmap, progress and memory from the same data folder', async () => {
    const first = createRig()
    rigs.push(first)
    const { services, screen, clock } = first

    // Some reading (→ Inbox) and a session that gets past its first checkpoint.
    screen.show(WIKI)
    await services.start()
    await runFor(clock, MINUTE)
    screen.show(NOTES)
    await runFor(clock, 3 * MINUTE)
    expect(services.queries.inbox({ state: null, subjectId: null })).toHaveLength(1)

    const subject = services.subjects.create({
      name: 'Cell Biology',
      emoji: null,
      goal: 'Photosynthesis',
      deadline: '2026-12-12',
    })
    screen.show(CHATGPT)
    await runFor(clock, 3000)
    await services.study.start({ subjectId: subject.id, goal: null, question: null }, ctx(first))
    await services.study.next(ctx(first))
    const quiz = await services.study.next(ctx(first))
    if (quiz.kind !== 'quiz') throw new Error(`expected the checkpoint, got ${quiz.kind}`)
    for (const q of services.quizzes.get(quiz.quizId).questions) {
      services.quizzes.answer(quiz.quizId, q.id, q.correctIndex)
    }
    await services.quizzes.finish(quiz.quizId)
    const before = services.study.current()
    expect(before).toMatchObject({ phase: 'step', index: 3, total: 5 })
    const mastery = services.repos.concepts
      .listBySubject(subject.id)
      .map((c) => [c.name, c.mastery])
    await first.comp.close()

    // A new process: new helper, new brain, same folder.
    const second = createRig({ dir: first.dir, clock })
    rigs.push(second)
    const again = second.services
    await again.start()
    expect(again.queries.subjects().map((s) => [s.name, s.status, s.deadline])).toEqual(
      expect.arrayContaining([['Cell Biology', 'active', '2026-12-12']]),
    )
    const restored = again.study.current()
    expect(restored).toMatchObject({
      roadmapId: before?.roadmapId,
      subjectId: subject.id,
      phase: 'step',
      index: 3,
      total: 5,
    })
    expect(restored?.items.map((i) => i.status)).toEqual(before?.items.map((i) => i.status))
    const detail = again.queries.subject(subject.id)
    expect(detail.roadmap?.id).toBe(before?.roadmapId)
    expect(detail.subject.progress).toBeGreaterThan(0)
    expect(detail.concepts.map((c) => [c.name, c.mastery])).toEqual(expect.arrayContaining(mastery))
    expect(again.quizzes.get(quiz.quizId)).toMatchObject({ status: 'done', score: 1 })
    expect(again.queries.home().continue.map((c) => c.roadmapId)).toContain(before?.roadmapId)
    expect(again.queries.inbox({ state: null, subjectId: null })).toHaveLength(1)
    expect(second.comp.engine.mirror()?.pathFor(subject.id)).toMatch(/cell-biology\.md$/)

    // The session continues where it stopped: the next step is pasted from the stored roadmap.
    second.screen.show(CHATGPT)
    await runFor(second.clock, 3000)
    const step = await again.study.start(
      { subjectId: subject.id, goal: null, question: null },
      ctx(second),
    )
    expect(step.kind).toBe('paste')
    expect(again.study.current()).toMatchObject({ roadmapId: before?.roadmapId, index: 3 })
    expect(second.brain.calls.some((c) => c.method === 'buildRoadmap')).toBe(false)
  })
})
