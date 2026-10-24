/**
 * Mock handlers for study sessions, quizzes and exams, the coach chat (streamed via
 * 'chat.delta'), coach actions, the Ask bar and nudges.
 */
import type {
  ChatMessage,
  CoachAction,
  ExamSpec,
  MasteryStatus,
  Quiz,
  QuizResult,
  Roadmap,
} from '@shared/domain'
import { coachReply, fixPromptFor, streamChunks } from './coach-replies'
import type { HandlerMap, MockContext } from './context'
import { questionBank } from './demo-quizzes'
import { dueConcepts, picker, roadmapFor, sessionState } from './derive'
import { mockId, nowIso } from './time'

type StudyChannel =
  | 'session.get'
  | 'session.picker'
  | 'session.start'
  | 'session.next'
  | 'session.end'
  | 'quiz.get'
  | 'quiz.answer'
  | 'quiz.finish'
  | 'exams.create'
  | 'chat.history'
  | 'chat.send'
  | 'coach.runAction'
  | 'ask.submit'
  | 'nudge.act'

function emitSession(ctx: MockContext): void {
  ctx.emit('session.changed', sessionState(ctx.db))
  ctx.changed('roadmaps')
}

function coldStartRoadmap(subjectId: string, goal: string): Roadmap {
  const step = (
    idx: number,
    title: string,
    move: 'intuition' | 'definition' | 'worked_example' | 'explain_back',
  ) => ({
    kind: 'learn' as const,
    id: mockId('ri'),
    idx,
    title,
    objective: `Can explain ${goal.toLowerCase()} in your own words.`,
    concepts: [goal],
    move,
    promptDraft: `I'm new to ${goal}. ${title}: explain it in short bullets with one example. No greetings, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.`,
    promptSent: null,
    status: idx === 0 ? ('current' as const) : ('todo' as const),
  })
  return {
    id: mockId('rm'),
    subjectId,
    title: goal,
    goal: `Understand ${goal}`,
    startReason: 'No notes on this yet, so we start from the essentials.',
    offerPlacement: true,
    estimatedMinutes: 25,
    status: 'active',
    carry: [],
    nextMilestone: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    items: [
      step(0, 'The big picture', 'intuition'),
      step(1, 'Key terms', 'definition'),
      {
        kind: 'checkpoint',
        id: mockId('ri'),
        idx: 2,
        title: 'Checkpoint 1',
        covers: [goal],
        probes: [],
        nQuestions: 3,
        quizId: null,
        score: null,
        status: 'todo',
      },
      step(3, 'A worked example', 'worked_example'),
      step(4, 'Explain it back', 'explain_back'),
      {
        kind: 'checkpoint',
        id: mockId('ri'),
        idx: 5,
        title: 'Final checkpoint',
        covers: [goal],
        probes: [],
        nQuestions: 4,
        quizId: null,
        score: null,
        status: 'todo',
      },
    ],
  }
}

function buildExam(ctx: MockContext, spec: ExamSpec): Quiz {
  const bank = questionBank()
  const struggling = new Set(
    ctx.db.concepts.filter((c) => c.status !== 'mastered').map((c) => c.id),
  )
  const due = new Set(dueConcepts(ctx.db).map((c) => c.id))
  const pool = spec.subjectIds.flatMap((id) => bank[id] ?? [])
  const rank = (cid: string | null) =>
    spec.focus === 'weak'
      ? struggling.has(cid ?? '')
        ? 0
        : 1
      : spec.focus === 'due'
        ? due.has(cid ?? '')
          ? 0
          : 1
        : 0
  const questions = [...pool]
    .sort((a, b) => rank(a.conceptId) - rank(b.conceptId))
    .filter(
      (x) =>
        spec.difficulty === 'mixed' ||
        (spec.difficulty === 'easy' ? x.difficulty <= 2 : x.difficulty >= 2),
    )
    .slice(0, spec.count)
    .map((x) => ({ ...x, id: mockId('q') }))
  const names = spec.subjectIds.map(
    (id) => ctx.db.subjects.find((s) => s.id === id)?.name ?? 'Subject',
  )
  const label = { weak: 'Weak-spots exam', due: 'Due reviews', everything: 'Everything' }[
    spec.focus
  ]
  return {
    id: mockId('quiz'),
    kind: 'exam',
    title: `${label} · ${names.join(' + ')}`,
    subjectIds: spec.subjectIds,
    roadmapId: null,
    roadmapItemId: null,
    status: 'generating',
    questions,
    answers: [],
    score: null,
    createdAt: nowIso(),
    completedAt: null,
  }
}

function createExam(ctx: MockContext, spec: ExamSpec): Quiz {
  const quiz = buildExam(ctx, spec)
  ctx.db.quizzes.push(quiz)
  ctx.changed('quizzes', [quiz.id])
  ctx.later(1400, () => {
    quiz.status = quiz.questions.length ? 'ready' : 'failed'
    ctx.changed('quizzes', [quiz.id])
  })
  return structuredClone({ ...quiz, questions: [] })
}

function findQuiz(ctx: MockContext, id: string): Quiz {
  const quiz = ctx.db.quizzes.find((q) => q.id === id)
  if (!quiz) throw new Error('That exam no longer exists.')
  return quiz
}

function statusFor(correct: number, total: number): MasteryStatus {
  if (correct === total) return total >= 2 ? 'mastered' : 'learning'
  return correct / total < 0.5 ? 'struggling' : 'learning'
}

function finishQuiz(ctx: MockContext, quiz: Quiz): QuizResult {
  const byName = new Map<string, { correct: number; total: number }>()
  for (const q of quiz.questions) {
    const a = quiz.answers.find((x) => x.questionId === q.id)
    const row = byName.get(q.conceptName) ?? { correct: 0, total: 0 }
    row.total += 1
    if (a?.correct) row.correct += 1
    byName.set(q.conceptName, row)
  }
  const gaps = quiz.questions.flatMap((q) => {
    const a = quiz.answers.find((x) => x.questionId === q.id)
    if (!a || a.correct) return []
    return [{ concept: q.conceptName, misconception: q.options[a.chosenIndex] ?? '' }]
  })
  const correct = quiz.answers.filter((a) => a.correct).length
  const total = quiz.questions.length
  if (quiz.status !== 'done') {
    ctx.db.questionsAnswered += quiz.answers.length
    ctx.db.correct += correct
  }
  quiz.status = 'done'
  quiz.score = total ? correct / total : 0
  quiz.completedAt = quiz.completedAt ?? nowIso()
  ctx.changed('quizzes', [quiz.id])
  const topic = ctx.db.subjects.find((s) => s.id === quiz.subjectIds[0])?.name ?? 'this'
  return {
    quizId: quiz.id,
    score: quiz.score,
    correct,
    total,
    byConcept: [...byName].map(([conceptName, r]) => ({
      conceptName,
      ...r,
      status: statusFor(r.correct, r.total),
    })),
    gaps,
    fixPrompt: gaps.length
      ? fixPromptFor(
          gaps.map((g) => g.misconception),
          topic,
        )
      : null,
    nextTopic: quiz.subjectIds.includes('sub_orgo') ? 'E1 vs E2 eliminations' : 'Diagonalisation',
  }
}

async function streamReply(ctx: MockContext, thread: string, text: string): Promise<ChatMessage> {
  const reply = coachReply(ctx.db, text)
  const id = mockId('msg')
  for (const chunk of streamChunks(reply.content)) {
    await new Promise((r) => setTimeout(r, 28))
    ctx.emit('chat.delta', { thread, messageId: id, delta: chunk, done: false })
  }
  ctx.emit('chat.delta', { thread, messageId: id, delta: '', done: true })
  const msg: ChatMessage = {
    id,
    thread,
    role: 'assistant',
    content: reply.content,
    actions: reply.actions,
    createdAt: nowIso(),
  }
  ctx.db.chat.push(msg)
  ctx.changed('chat', [id])
  return msg
}

function startSession(ctx: MockContext, subjectId: string | null, goal: string | null) {
  const { db } = ctx
  const sid =
    subjectId ?? db.settings.focusSubjectId ?? db.subjects.find((s) => s.status === 'active')?.id
  if (!sid) throw new Error('Add a subject first.')
  let roadmap = roadmapFor(db, sid)
  const fresh =
    !roadmap ||
    (goal !== null &&
      !roadmap.title.toLowerCase().includes(goal.toLowerCase()) &&
      roadmap.status !== 'active')
  if (!roadmap || (fresh && goal)) {
    roadmap = coldStartRoadmap(
      sid,
      goal ?? db.subjects.find((s) => s.id === sid)?.name ?? 'New topic',
    )
    db.roadmaps.push(roadmap)
  }
  for (const r of db.roadmaps) if (r.status === 'active' && r.id !== roadmap.id) r.status = 'paused'
  roadmap.status = 'active'
  db.sessionRoadmapId = roadmap.id
  db.sessionPhase = 'planning'
  ctx.later(1600, () => {
    db.sessionPhase = null
    emitSession(ctx)
  })
  emitSession(ctx)
  const state = sessionState(db)
  if (!state) throw new Error('Could not start the session.')
  return state
}

export const studyHandlers: HandlerMap<StudyChannel> = {
  'session.get': (ctx) => sessionState(ctx.db),
  'session.picker': (ctx) => picker(ctx.db),
  'session.start': (ctx, { subjectId, goal, question }) =>
    startSession(ctx, subjectId, goal ?? question),
  'session.next': (ctx) => {
    const r = ctx.db.roadmaps.find((x) => x.id === ctx.db.sessionRoadmapId)
    if (!r) return null
    const i = r.items.findIndex((x) => x.status === 'current')
    const cur = r.items[i]
    if (cur) cur.status = 'done'
    const next = r.items[i + 1]
    if (next) next.status = 'current'
    else r.status = 'done'
    r.updatedAt = nowIso()
    emitSession(ctx)
    return sessionState(ctx.db)
  },
  'session.end': (ctx) => {
    const r = ctx.db.roadmaps.find((x) => x.id === ctx.db.sessionRoadmapId)
    if (r && r.status === 'active') r.status = 'paused'
    ctx.db.sessionRoadmapId = null
    emitSession(ctx)
  },

  'quiz.get': (ctx, id) => structuredClone(findQuiz(ctx, id)),
  'quiz.answer': (ctx, { quizId, questionId, chosenIndex }) => {
    const quiz = findQuiz(ctx, quizId)
    const q = quiz.questions.find((x) => x.id === questionId)
    if (!q) throw new Error('Unknown question.')
    const correct = chosenIndex === q.correctIndex
    quiz.answers = quiz.answers.filter((a) => a.questionId !== questionId)
    quiz.answers.push({ questionId, chosenIndex, correct, answeredAt: nowIso() })
    if (quiz.status === 'ready') quiz.status = 'in_progress'
    return { correct, correctIndex: q.correctIndex, rationale: q.rationales[chosenIndex] ?? '' }
  },
  'quiz.finish': (ctx, id) => finishQuiz(ctx, findQuiz(ctx, id)),
  'exams.create': (ctx, spec) => createExam(ctx, spec),

  'chat.history': (ctx, thread) => ctx.db.chat.filter((m) => m.thread === thread),
  'chat.send': async (ctx, { thread, text }) => {
    const user: ChatMessage = {
      id: mockId('msg'),
      thread,
      role: 'user',
      content: text,
      actions: [],
      createdAt: nowIso(),
    }
    ctx.db.chat.push(user)
    ctx.changed('chat', [user.id])
    await new Promise((r) => setTimeout(r, 450))
    return streamReply(ctx, thread, text)
  },
  'coach.runAction': (ctx, action: CoachAction) => {
    switch (action.type) {
      case 'start_roadmap':
        startSession(ctx, action.subjectId, action.goal)
        return
      case 'create_exam': {
        const quiz = createExam(ctx, action.spec)
        ctx.openRoute(`/exams/${quiz.id}`)
        return
      }
      case 'start_review': {
        const subjectIds = [
          ...new Set(
            ctx.db.concepts.filter((c) => action.conceptIds.includes(c.id)).map((c) => c.subjectId),
          ),
        ]
        const quiz = createExam(ctx, {
          subjectIds: subjectIds.length ? subjectIds : ['sub_orgo'],
          count: 5,
          focus: 'due',
          difficulty: 'mixed',
        })
        ctx.openRoute(`/exams/${quiz.id}`)
        return
      }
      case 'set_focus':
        ctx.db.settings.focusSubjectId = action.subjectId
        ctx.changed('settings')
        return
      case 'open_subject':
        ctx.openRoute(`/subjects/${action.subjectId}/roadmap`)
        return
      case 'insert_prompt':
        return
    }
  },
  'ask.submit': (ctx, { text }) => {
    const r = coachReply(ctx.db, text)
    return { reply: r.content, actions: r.actions, pasted: false }
  },
  'nudge.act': () => undefined,
}
