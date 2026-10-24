/**
 * Real engine, flow F2, driven through the shell's own SessionFlow: with ChatGPT detected, start
 * a session on a subject → roadmap → step prompts pasted via helper input.write → checkpoint quiz
 * (grounded in what the AI answered) → answers → mastery in SQLite, misses carried into the next
 * step's prompt and checkpoint → roadmap complete with the follow-up scheduled once.
 */
import type { StepInstruction } from '@shared/state'
import { afterEach, describe, expect, it } from 'vitest'
import type { StepResult } from '../flows/session-flow'
import { startShell } from './shell-kit'
import {
  CHATGPT,
  createRig,
  disposeRig,
  type FakeScreen,
  type Rig,
  runFor,
  type ScreenLine,
} from './test-kit'

type Paste = Extract<StepInstruction, { kind: 'paste' }>

function pasted(step: StepResult): Paste {
  if (step.instruction.kind !== 'paste')
    throw new Error(`expected a paste, got ${step.instruction.kind}`)
  return step.instruction
}

function quizOf(step: StepResult): string {
  if (step.instruction.kind !== 'quiz')
    throw new Error(`expected a quiz, got ${step.instruction.kind}`)
  return step.instruction.quizId
}

/** The student sends the pasted prompt and ChatGPT answers; perception sees the new text. */
function chatTurn(screen: FakeScreen, history: ScreenLine[], prompt: string, answer: string): void {
  history.push({ text: prompt, align: 'right' }, { text: answer, align: 'left' })
  screen.setLines(['ChatGPT', ...history, 'Ask anything'])
}

describe('composeReal: study session in an AI chat', () => {
  let rig: Rig
  afterEach(async () => {
    await disposeRig(rig)
  })

  it('pastes steps, runs the checkpoint, updates mastery and carries misses forward', async () => {
    rig = createRig()
    const { services, screen, clock, helper, brain, comp } = rig
    const shell = startShell(rig)
    const subject = services.subjects.create({
      name: 'Cell Biology',
      emoji: null,
      goal: 'Photosynthesis',
      deadline: null,
    })
    const followUps: string[] = []
    const onSessionComplete = comp.engine.followUps.onSessionComplete
    comp.engine.followUps.onSessionComplete = (id) => {
      followUps.push(id)
      onSessionComplete(id)
    }
    const chat: ScreenLine[] = []
    screen.show(CHATGPT)
    await services.start()
    await runFor(clock, 3000)
    expect(services.perception.aiChat()?.assistant).toBe('ChatGPT')

    // Start: the roadmap is planned and step 1 is pasted into the chat box (never sent).
    const first = await shell.core.sessions.start({
      subjectId: subject.id,
      goal: null,
      question: null,
    })
    const step1 = pasted(first)
    expect(first.write).toMatchObject({ ok: true })
    expect(helper.writes()).toEqual([step1.text])
    expect(helper.callsOf('input.write')[0]).toMatchObject({
      mode: 'insert',
      expectPid: CHATGPT.pid,
      target: { ref: 'ax-501-chat' },
    })
    expect(shell.core.overlay.state.toasts.map((t) => t.title)).not.toContain(
      'Why this prompt works',
    )
    const session = services.study.current()
    expect(session).toMatchObject({ subjectId: subject.id, phase: 'step', index: 0, total: 5 })
    expect(session?.assistant).toBe('ChatGPT')
    const roadmapId = session?.roadmapId ?? ''
    expect(services.repos.roadmaps.get(roadmapId)?.status).toBe('active')
    chatTurn(
      screen,
      chat,
      step1.text,
      'Plants turn light energy into chemical energy in chloroplasts.',
    )
    await runFor(clock, 4000)

    // Next: step 2; the checkpoint after it is generated from the chat 20 s later.
    const step2 = pasted(await shell.core.sessions.next())
    expect(step2.text).toContain('Photosynthesis mechanism')
    expect(helper.writes()).toHaveLength(2)
    chatTurn(
      screen,
      chat,
      step2.text,
      'The Calvin cycle uses ATP and NADPH from the light reactions.',
    )
    await runFor(clock, 25_000)
    const checkpointCall = brain.calls.find((c) => c.method === 'makeCheckpoint')
    expect(JSON.stringify(checkpointCall?.input)).toContain('The Calvin cycle uses ATP and NADPH')

    // Next: the checkpoint quiz opens on the overlay (nothing pasted).
    const quizId = quizOf(await shell.core.sessions.next())
    expect(shell.core.overlay.state.quiz).toEqual({ quizId })
    expect(services.study.current()?.phase).toBe('checkpoint')
    expect(helper.writes()).toHaveLength(2)
    const quiz = services.quizzes.get(quizId)
    expect(quiz).toMatchObject({ kind: 'checkpoint', roadmapId, status: 'ready' })
    const missed = 'Photosynthesis mechanism'
    expect(quiz.questions.map((q) => q.conceptName)).toContain(missed)

    for (const q of quiz.questions) {
      const wrong = q.conceptName === missed
      services.quizzes.answer(quizId, q.id, wrong ? (q.correctIndex + 1) % 4 : q.correctIndex)
    }
    const result = await services.quizzes.finish(quizId)
    expect(result.byConcept.find((c) => c.conceptName === missed)?.correct).toBe(0)
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(1)

    // Mastery lives in SQLite: the miss is struggling, the passed idea learning with a review.
    const weak = services.repos.concepts.findByName(subject.id, missed)
    const strong = services.repos.concepts.findByName(subject.id, 'Photosynthesis basics')
    expect(weak?.status).toBe('struggling')
    expect(strong).toMatchObject({ status: 'learning', box: 1 })
    expect(strong?.mastery).toBeGreaterThan(0.2)
    expect(strong?.nextReviewAt).not.toBeNull()
    const roadmap = services.repos.roadmaps.get(roadmapId)
    expect(roadmap?.carry).toEqual([missed])
    expect(roadmap?.items[2]).toMatchObject({ status: 'done', quizId })
    expect(services.study.current()).toMatchObject({ phase: 'step', index: 3 })

    // The missed idea is carried into the next step's prompt…
    const step3 = pasted(await shell.core.sessions.next())
    expect(step3.text).toContain('Photosynthesis application')
    expect(step3.text).toContain(`A common misconception about ${missed}`)
    expect(step3.text).toContain("explain why that's wrong")
    chatTurn(screen, chat, step3.text, 'Greenhouse growers raise CO2 to speed up the Calvin cycle.')
    await runFor(clock, 25_000)

    // …and re-tested in the final checkpoint.
    const finalId = quizOf(await shell.core.sessions.next())
    const final = services.quizzes.get(finalId)
    expect(final.questions.map((q) => q.conceptName)).toContain(missed)
    for (const q of final.questions) services.quizzes.answer(finalId, q.id, q.correctIndex)
    expect((await services.quizzes.finish(finalId)).score).toBe(1)
    expect(services.repos.roadmaps.get(roadmapId)?.carry).toEqual([])

    // Finish: the roadmap is done and the follow-up is scheduled exactly once.
    const done = await shell.core.sessions.next()
    expect(done.instruction.kind).toBe('complete')
    expect(services.repos.roadmaps.get(roadmapId)?.status).toBe('done')
    expect(shell.core.overlay.state.toasts).toEqual([]) // no box: only the selection menu and /d reply pop up
    expect(followUps).toEqual([roadmapId])
    expect(helper.writes()).toHaveLength(3)
  })

  it('surfaces a planning failure as an error and keeps no half-made session', async () => {
    rig = createRig({
      brain: {
        buildRoadmap: async () => {
          throw new Error('all providers are down')
        },
      },
    })
    const { services, screen, clock, helper } = rig
    const shell = startShell(rig)
    const subject = services.subjects.create({
      name: 'Algebra',
      emoji: null,
      goal: null,
      deadline: null,
    })
    screen.show(CHATGPT)
    await services.start()
    await runFor(clock, 3000)
    await expect(
      shell.core.sessions.start({ subjectId: subject.id, goal: null, question: null }),
    ).rejects.toThrow(/Couldn't build a roadmap: all providers are down/)
    expect(services.study.current()).toBeNull()
    expect(helper.writes()).toEqual([])
    expect(services.repos.roadmaps.listBySubject(subject.id)).toEqual([])
  })
})
