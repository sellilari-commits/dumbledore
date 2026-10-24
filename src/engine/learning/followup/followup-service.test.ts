import { createMasteryModel } from '@engine/learning/mastery/mastery-model'
import { silentLog, variedBrain } from '@engine/learning/quiz/quiz-fixtures'
import { createQuizService } from '@engine/learning/quiz/quiz-service'
import { HOUR_MS, MINUTE_MS } from '@engine/scheduler/local-time'
import { frontmost, shown, studentWorld, textField } from '@engine/scheduler/scheduler-fixtures'
import type { Concept, Nudge, Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { createFollowUpService } from './followup-service'

function setup(start: string) {
  const brain = variedBrain()
  const w = studentWorld({ start, brain })
  const mastery = createMasteryModel({ repos: w.repos, localTime: w.localTime })
  const deps = {
    repos: w.repos,
    brain,
    bus: w.bus,
    clock: w.clock,
    localTime: w.localTime,
    log: silentLog,
  }
  const quizzes = createQuizService({ ...deps, mastery })
  const followUps = createFollowUpService({ ...deps, mastery, signals: w.signals })
  const chem = w.repos.subjects.create({ name: 'Organic Chemistry', emoji: '🧪' })
  const concept = (name: string, patch: Partial<Concept> = {}) =>
    w.repos.concepts.update(w.repos.concepts.upsert({ subjectId: chem.id, name }).id, patch)
  const nudgesShown = () => shown(w.events).map((e) => (e.payload as { nudge: Nudge }).nudge)
  /** Lets a just-opened break be noticed (next poll), its check run (5 s later) and land. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await w.student.pass(15_000)
      await followUps.settled()
    }
  }
  return { ...w, brain, mastery, quizzes, followUps, chem, concept, nudgesShown, settle }
}

const minutesOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

describe('FollowUpService over simulated days', () => {
  it('S6: a miss tonight becomes a review nudge at tomorrow morning’s break; the review reschedules it', async () => {
    const s = setup('2026-10-24T20:00:00.000Z')
    const sn1 = s.concept('SN1')
    s.followUps.start()

    const evening = await s.quizzes.startReview([sn1.id])
    for (const q of evening.questions) s.quizzes.answer(evening.id, q.id, (q.correctIndex + 1) % 4)
    await s.quizzes.finish(evening.id)
    expect(s.repos.concepts.get(sn1.id)).toMatchObject({
      box: 1,
      status: 'struggling',
      nextReviewAt: '2026-10-25T04:00:00.000Z',
    })

    await s.student.pass(2 * HOUR_MS) // keeps studying, no break
    s.student.lock(true)
    s.clock.set('2026-10-25T08:30:00.000Z') // sleeps through quiet hours
    await s.followUps.settled()
    expect(s.nudgesShown()).toEqual([])

    s.student.lock(false) // back at the desk: a natural break
    await s.settle()
    const [nudge] = s.nudgesShown()
    expect(nudge).toMatchObject({
      kind: 'morning_plan',
      action: { type: 'start_review', conceptIds: [sn1.id] },
    })
    expect(
      Date.parse(nudge?.shownAt ?? '') - Date.parse('2026-10-25T08:30:00.000Z'),
    ).toBeLessThanOrEqual(45_000)

    const { action } = s.followUps.act(nudge?.id ?? '', 'accept')
    expect(action?.type).toBe('start_review')
    const review = await s.quizzes.startReview(
      action?.type === 'start_review' ? action.conceptIds : [],
    )
    for (const q of review.questions) s.quizzes.answer(review.id, q.id, q.correctIndex)
    const result = await s.quizzes.finish(review.id)
    expect(result.score).toBe(1)
    expect(s.repos.concepts.get(sn1.id)).toMatchObject({
      box: 2,
      status: 'learning',
      nextReviewAt: '2026-10-28T04:00:00.000Z',
    })
    expect(s.followUps.dueSummary()).toEqual({ count: 0, conceptIds: [] })

    await s.student.pass(3 * HOUR_MS)
    await s.student.away(5 * MINUTE_MS) // another break: nothing left to say
    await s.settle()
    expect(s.nudgesShown()).toHaveLength(1)
    s.followUps.stop()
  })

  it('holds the caps across three busy days of natural breaks', async () => {
    const s = setup('2026-10-24T07:55:00.000Z')
    for (let i = 0; i < 6; i++) s.concept(`Tricky ${i}`, { status: 'struggling', struggleCount: 2 })
    for (let i = 0; i < 4; i++)
      s.concept(`Due ${i}`, { box: 1, nextReviewAt: '2026-10-24T04:00:00.000Z' })
    s.repos.subjects.update(s.chem.id, { deadline: '2026-10-26' })
    s.followUps.start()
    for (let day = 0; day < 3; day++) {
      for (let cycle = 0; cycle < 36; cycle++) {
        await s.student.pass(20 * MINUTE_MS)
        await s.student.away(3 * MINUTE_MS)
        await s.student.pass(15_000)
      }
      s.student.lock(true)
      s.clock.set(`2026-10-${25 + day}T07:55:00.000Z`)
      s.student.lock(false)
    }
    await s.followUps.settled()
    const all = s.nudgesShown()
    expect(all.length).toBeGreaterThanOrEqual(6)
    const byDay = new Map<string, number>()
    for (const n of all)
      byDay.set(n.createdAt.slice(0, 10), (byDay.get(n.createdAt.slice(0, 10)) ?? 0) + 1)
    for (const count of byDay.values()) expect(count).toBeLessThanOrEqual(4)
    const times = all.map((n) => Date.parse(n.shownAt ?? ''))
    for (let i = 1; i < times.length; i++)
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(HOUR_MS)
    for (const n of all) {
      const m = minutesOfDay(n.shownAt ?? '')
      expect(m >= 8 * 60 && m < 22 * 60 + 30).toBe(true) // never in quiet hours
    }
    expect(new Set(all.map((n) => n.dedupeKey)).size).toBe(all.length) // never repeated
    s.followUps.stop()
  })

  it('never nudges while typing, in full screen or in a meeting', async () => {
    const s = setup('2026-10-24T11:30:00.000Z') // past the start-of-day break
    s.concept('SN1', { box: 1, nextReviewAt: '2026-10-24T04:00:00.000Z' })
    s.followUps.start()
    await s.student.pass(15 * MINUTE_MS)

    const chat = textField()
    await s.student.away(4 * MINUTE_MS)
    s.student.focus(chat) // comes back straight into a chat box
    for (let i = 0; i < 16; i++) {
      await s.student.pass(15_000) // typing
      s.student.focus(chat)
    }
    s.student.focus(null)

    s.student.setFront(frontmost('com.apple.TV', 'TV', { isFullScreen: true }))
    await s.student.away(4 * MINUTE_MS) // a video, then the trackpad
    await s.student.pass(4 * MINUTE_MS)
    s.student.setFront(frontmost('com.apple.Preview', 'Preview'))

    await s.student.pass(15 * MINUTE_MS)
    s.student.switchTo('us.zoom.xos', 'zoom.us')
    await s.student.away(4 * MINUTE_MS)
    await s.student.pass(4 * MINUTE_MS)
    expect(s.nudgesShown()).toEqual([])

    s.student.switchTo('com.apple.Preview', 'Preview')
    await s.student.pass(15 * MINUTE_MS) // the call is over
    await s.student.away(4 * MINUTE_MS)
    await s.settle()
    expect(s.nudgesShown().map((n) => n.kind)).toEqual(['review_due'])
    s.followUps.stop()
  })

  it('follows up 30–60 min after a finished study session', async () => {
    const s = setup('2026-10-24T14:00:00.000Z')
    const sn1 = s.concept('SN1', {
      box: 1,
      mastery: 0.4,
      status: 'learning',
      nextReviewAt: '2026-10-25T04:00:00.000Z',
    })
    const roadmap: Roadmap = {
      id: 'rdm_sn1',
      subjectId: s.chem.id,
      title: 'SN1 from the basics',
      goal: 'Understand SN1',
      startReason: '',
      offerPlacement: false,
      estimatedMinutes: 20,
      status: 'done',
      items: [
        {
          kind: 'learn',
          id: 'itm_a',
          idx: 0,
          title: 'SN1',
          objective: '',
          concepts: ['SN1'],
          move: 'intuition',
          promptDraft: '',
          promptSent: null,
          status: 'done',
        },
      ],
      carry: [],
      nextMilestone: null,
      createdAt: '2026-10-24T13:30:00.000Z',
      updatedAt: '2026-10-24T14:00:00.000Z',
    }
    s.repos.roadmaps.save(roadmap)
    s.followUps.start()
    await s.settle()
    const doneAt = s.clock.now()
    s.followUps.onSessionComplete(roadmap.id)
    await s.student.pass(29 * MINUTE_MS)
    expect(s.nudgesShown()).toEqual([])
    await s.student.pass(2 * MINUTE_MS)
    await s.followUps.settled()
    const [nudge] = s.nudgesShown()
    expect(nudge).toMatchObject({
      kind: 'session_followup',
      dedupeKey: 'followup:rdm_sn1',
      action: { type: 'start_review', conceptIds: [sn1.id] },
    })
    const sinceDone = Date.parse(nudge?.shownAt ?? '') - doneAt
    expect(sinceDone).toBeGreaterThanOrEqual(30 * MINUTE_MS)
    expect(sinceDone).toBeLessThan(31 * MINUTE_MS)
    s.followUps.stop()
  })

  it('expires an ignored nudge after an hour and brings a snoozed one back', async () => {
    const s = setup('2026-10-24T11:30:00.000Z') // past the start-of-day break
    for (const name of ['SN1', 'SN2', 'E1'])
      s.concept(name, { box: 1, nextReviewAt: '2026-10-24T04:00:00.000Z' })
    s.concept('Tricky', { status: 'struggling', struggleCount: 1 })
    s.followUps.start()
    await s.student.pass(15 * MINUTE_MS)
    await s.student.away(3 * MINUTE_MS)
    await s.settle()
    const [first] = s.nudgesShown()
    expect(first?.kind).toBe('review_due')
    await s.student.pass(61 * MINUTE_MS)
    expect(s.repos.nudges.listSince('2026-10-24T00:00:00.000Z')[0]?.outcome).toBe('expired')

    await s.student.away(3 * MINUTE_MS)
    await s.settle()
    const second = s.nudgesShown()[1]
    expect(second?.kind).toBe('struggle')
    s.followUps.act(second?.id ?? '', 'snooze')
    await s.student.pass(60 * MINUTE_MS)
    await s.settle()
    const third = s.nudgesShown()[2]
    expect(third).toMatchObject({ id: second?.id, outcome: 'pending' })
    s.followUps.stop()
  })

  it('reports due reviews, ramps reviews before deadlines and builds the profile', async () => {
    const s = setup('2026-10-24T12:00:00.000Z')
    const due = s.concept('SN1', { box: 1, nextReviewAt: '2026-10-24T04:00:00.000Z' })
    const later = s.concept('E1', { box: 3, nextReviewAt: '2026-11-03T04:00:00.000Z' })
    const physics = s.repos.subjects.create({ name: 'Physics' })
    const hidden = s.repos.concepts.upsert({ subjectId: physics.id, name: 'Torque' })
    s.repos.concepts.update(hidden.id, { box: 1, nextReviewAt: '2026-10-24T04:00:00.000Z' })
    s.repos.subjects.update(physics.id, { status: 'archived' })
    expect(s.followUps.dueSummary()).toEqual({ count: 1, conceptIds: [due.id] })

    s.repos.subjects.update(s.chem.id, { deadline: '2026-10-26T09:00:00.000Z' })
    s.repos.profile.update({ aboutMe: 'Chemistry student' })
    await s.followUps.check('test')
    await s.followUps.settled()
    expect(s.repos.concepts.get(later.id)?.nextReviewAt).toBe('2026-10-25T04:00:00.000Z')
    expect(s.repos.profile.get().summary).toBe('Chemistry student')
  })

  it('recovers recent follow-ups on start and leaves no timers after stop', async () => {
    const s = setup('2026-10-24T14:20:00.000Z')
    s.concept('SN1')
    s.repos.roadmaps.save({
      id: 'rdm_done',
      subjectId: s.chem.id,
      title: 'Done before a restart',
      goal: 'SN1',
      startReason: '',
      offerPlacement: false,
      estimatedMinutes: 10,
      status: 'done',
      items: [],
      carry: [],
      nextMilestone: null,
      createdAt: '2026-10-24T13:30:00.000Z',
      updatedAt: '2026-10-24T14:00:00.000Z',
    })
    expect(s.clock.pendingTimers()).toBe(0)
    s.followUps.start()
    expect(s.clock.pendingTimers()).toBeGreaterThan(0)
    await s.student.pass(11 * MINUTE_MS)
    await s.followUps.settled()
    expect(s.nudgesShown().map((n) => n.dedupeKey)).toEqual(['followup:rdm_done'])
    s.followUps.stop()
    expect(s.clock.pendingTimers()).toBe(0)
  })
})
