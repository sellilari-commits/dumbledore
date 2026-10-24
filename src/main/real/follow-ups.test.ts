/**
 * Real engine, flow F8: a finished study session schedules its follow-up (a nudge 30–60 min
 * later, at the natural break after the session); days later on the FakeClock the checkpoint
 * concepts are due, a review nudge appears at the next natural break, and accepting it builds a
 * review quiz. The shell's overlay shows each nudge as exactly one toast.
 */
import type { ChatContext } from '@engine/contracts'
import type { Nudge } from '@shared/domain'
import type { StepInstruction } from '@shared/state'
import { afterEach, describe, expect, it } from 'vitest'
import { startShell } from './shell-kit'
import {
  CHATGPT,
  createRig,
  disposeRig,
  flushAsync,
  localNoon,
  MINUTE,
  NOTES,
  type Rig,
  runFor,
} from './test-kit'

/** Runs a whole roadmap through the StudyService, missing `missed` in the first checkpoint. */
async function finishSession(rig: Rig, subjectId: string, missed: string): Promise<string> {
  const { services } = rig
  const ctx = (): ChatContext => ({
    assistant: 'ChatGPT',
    chatExcerpt: services.perception.chatExcerpt(1500),
    pageContext: '',
  })
  let step: StepInstruction = await services.study.start(
    { subjectId, goal: null, question: null },
    ctx(),
  )
  const roadmapId = services.study.current()?.roadmapId ?? ''
  let quizzes = 0
  for (let guard = 0; guard < 12 && step.kind !== 'complete'; guard++) {
    if (step.kind === 'quiz') {
      const quiz = services.quizzes.get(step.quizId)
      for (const q of quiz.questions) {
        const wrong = quizzes === 0 && q.conceptName === missed
        services.quizzes.answer(quiz.id, q.id, wrong ? (q.correctIndex + 1) % 4 : q.correctIndex)
      }
      await services.quizzes.finish(quiz.id)
      quizzes++
    }
    await runFor(rig.clock, 30_000, 1000) // reading the AI's answer
    step = await services.study.next(ctx())
  }
  expect(step.kind).toBe('complete')
  expect(quizzes).toBe(2)
  return roadmapId
}

describe('composeReal: follow-ups', () => {
  let rig: Rig
  afterEach(async () => {
    await disposeRig(rig)
  })

  it('nudges after a finished session and again when its reviews fall due', async () => {
    rig = createRig()
    const { services, screen, clock, comp } = rig
    const shell = startShell(rig)
    const nudges: Nudge[] = []
    const toasts = new Map<string, number>() // nudge id → overlay toasts right after it was shown
    services.bus.on('nudge:ready', ({ nudge }) => {
      nudges.push(nudge)
      queueMicrotask(() => {
        const shown = shell.core.overlay.state.toasts.filter((t) => t.nudgeId === nudge.id)
        toasts.set(nudge.id, shown.length)
      })
    })
    const subject = services.subjects.create({
      name: 'Cell Biology',
      emoji: null,
      goal: 'Photosynthesis',
      deadline: null,
    })
    screen.show(CHATGPT)
    await services.start()
    await runFor(clock, 3000)
    const roadmapId = await finishSession(rig, subject.id, 'Photosynthesis mechanism')
    expect(services.repos.roadmaps.get(roadmapId)?.status).toBe('done')
    expect(nudges).toEqual([])

    // 30–60 minutes after the session: the follow-up nudge, at the natural break.
    screen.show(NOTES)
    await runFor(clock, 40 * MINUTE, 5000)
    const followUp = nudges.find((n) => n.kind === 'session_followup')
    expect(followUp).toBeDefined()
    expect(followUp?.action?.type).toBe('start_review')
    expect(toasts.get(followUp?.id ?? '')).toBe(1)
    expect(services.repos.nudges.listSince(new Date(0).toISOString()).map((n) => n.kind)).toEqual([
      'session_followup',
    ])

    // Nothing is due yet. The Mac sleeps for two days (the engine stops and starts again; a
    // running engine would get there too, but the fake helper's call log makes that slow).
    expect(services.followUps.dueSummary().count).toBe(0)
    await services.stop()
    clock.set(new Date(localNoon(28)).toISOString())
    await services.start()
    await flushAsync(20)
    const due = services.followUps.dueSummary()
    const names = due.conceptIds.map((id) => services.repos.concepts.get(id)?.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'Photosynthesis basics',
        'Photosynthesis mechanism',
        'Photosynthesis application',
      ]),
    )

    // The student comes back after a break: the review nudge appears…
    const { receptivity } = comp.engine.followUps
    screen.idleSeconds = 10 * 60
    await receptivity.refresh()
    screen.idleSeconds = 0
    await receptivity.refresh()
    await runFor(clock, 10_000, 1000)
    const review = nudges.at(-1)
    expect(review?.kind).toBe('review_due')
    expect(review?.action?.type).toBe('start_review')
    expect(toasts.get(review?.id ?? '')).toBe(1)

    // …and accepting it builds a review quiz over the due concepts.
    const acted = comp.engine.followUps.act(review?.id ?? '', 'accept')
    expect(acted.nudge.outcome).toBe('accepted')
    if (acted.action?.type !== 'start_review') throw new Error('expected a review action')
    expect(acted.action.conceptIds.length).toBeGreaterThanOrEqual(3)
    const quiz = await services.quizzes.startReview(acted.action.conceptIds)
    expect(quiz).toMatchObject({ kind: 'review', status: 'ready', subjectIds: [subject.id] })
    expect(quiz.questions.length).toBeGreaterThan(0)
  }, 20_000)
})
