/**
 * Chat tools read and search: every kind returns what the app knows, with ids; a paused roadmap
 * at step 3 of 6 is visible with its steps (the chat once claimed no roadmap existed); unknown ids
 * fail cleanly; settings carry no secrets; long text is clipped so results stay small.
 */
import { FakeClock } from '@engine/clock'
import { createQueryService } from '@engine/queries/query-service'
import { createMemoryControl } from '@engine/subjects/memory-control'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Quiz, Roadmap, RoadmapItem, Settings } from '@shared/domain'
import type { SessionState } from '@shared/state'
import { describe, expect, it } from 'vitest'
import { createReadTools, ReadInput, withoutSecrets } from './read'
import type { ChatTool, ToolOutcome } from './types'

const NOW = '2026-10-25T07:20:00.000Z'
const SRC = {
  app: 'Safari',
  bundleId: null,
  url: 'https://ex.org/causal?token=abc#x',
  title: 'Causal',
}

function item(
  idx: number,
  title: string,
  status: RoadmapItem['status'],
  kind: RoadmapItem['kind'] = 'learn',
): RoadmapItem {
  const base = { id: `item_${idx}`, idx, title, status }
  return kind === 'learn'
    ? {
        ...base,
        kind,
        objective: `Understand ${title}`,
        concepts: [title],
        move: 'intuition',
        promptDraft: '',
        promptSent: null,
      }
    : {
        ...base,
        kind,
        covers: ['Causal Inference'],
        probes: [],
        nQuestions: 3,
        quizId: null,
        score: null,
      }
}

function roadmap(
  id: string,
  subjectId: string,
  title: string,
  status: Roadmap['status'],
  items: RoadmapItem[],
  carry: string[] = [],
): Roadmap {
  return {
    id,
    subjectId,
    title,
    goal: title,
    startReason: 'asked',
    offerPlacement: false,
    estimatedMinutes: 60,
    status,
    items,
    carry,
    nextMilestone: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function world(session: SessionState | null = null) {
  const clock = new FakeClock(NOW)
  const repos = createMemoryRepos(clock)
  const stats = repos.subjects.create({
    name: 'Statistics',
    status: 'active',
    goal: 'Pass the exam',
    description: 'x'.repeat(2000),
  })
  const old = repos.subjects.create({ name: 'Latin', status: 'archived' })
  repos.subjects.create({ name: 'Astronomy', status: 'suggested' })
  const causal = repos.concepts.upsert({
    subjectId: stats.id,
    name: 'Causal Inference',
    summary: 'Telling cause from correlation',
  })
  const noise = repos.concepts.upsert({
    subjectId: stats.id,
    name: 'Additive Noise Models',
    parentName: 'Causal Inference',
  })
  repos.concepts.update(noise.id, { status: 'struggling', struggleCount: 2 })
  repos.edges.add({ fromId: causal.id, toId: noise.id, why: 'builds on it' })
  const note = repos.notes.add({
    subjectId: stats.id,
    conceptId: noise.id,
    encounterId: null,
    kind: 'misconception',
    text: 'Thinks noise must be Gaussian',
    source: SRC,
  }).note
  const loose = repos.notes.add({
    subjectId: null,
    conceptId: null,
    encounterId: null,
    kind: 'fact',
    text: 'Bees dance to share directions',
    source: SRC,
  }).note
  repos.subjects.setStudyPreferences(stats.id, {
    instruction: 'Focus on noise models',
    focus: [noise.id],
    skip: [],
    focusNames: [],
    skipNames: [],
    updatedAt: NOW,
  })
  repos.roadmaps.save(
    roadmap(
      'rdm_causal',
      stats.id,
      'Causal Inference and Functional Noise Models',
      'paused',
      [
        item(0, 'Causal Inference vs. Association', 'done'),
        item(1, 'Additive vs. General Functional Noise', 'done'),
        item(2, 'Checkpoint 1 · 3 questions', 'current', 'checkpoint'),
        item(3, 'Heteroskedastic and Post-Nonlinear Models', 'todo'),
        item(4, 'Applications in Political Science', 'todo'),
        item(5, 'Checkpoint 2 · 3 questions', 'todo', 'checkpoint'),
      ],
      ['Additive Noise Models'],
    ),
  )
  repos.roadmaps.save(roadmap('rdm_old', stats.id, 'Basics', 'done', [item(0, 'Means', 'done')]))
  const encounter = repos.encounters.add({
    subjectId: stats.id,
    conceptId: causal.id,
    episodeId: null,
    seen: 'A DAG with three nodes',
    bigPicture: 'How do we know X causes Y?',
    topicPath: ['Statistics', 'Causal Inference'],
    understanding: 'unclear',
    evidence: 'reread twice',
    openQuestions: ['What is a collider?'],
    keyTerms: ['DAG'],
    source: SRC,
    dwellSeconds: 300,
  })
  const quiz: Quiz = {
    id: 'qz_1',
    kind: 'exam',
    title: 'Statistics · weak spots',
    subjectIds: [stats.id],
    roadmapId: null,
    roadmapItemId: null,
    status: 'done',
    questions: [
      {
        id: 'q_1',
        conceptName: 'Causal Inference',
        conceptId: causal.id,
        stem: 'Which is a confounder?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 2,
        rationales: ['no', 'no', 'yes, it causes both', 'no'],
        difficulty: 2,
        carriedFrom: null,
      },
    ],
    answers: [{ questionId: 'q_1', chosenIndex: 1, correct: false, answeredAt: NOW }],
    score: 0,
    createdAt: NOW,
    completedAt: NOW,
  }
  repos.quizzes.save(quiz)
  repos.quizzes.save({ ...quiz, id: 'qz_cp', kind: 'checkpoint', title: 'Checkpoint 1' })
  repos.assignments.upsert({
    subjectId: stats.id,
    title: 'Problem set 3',
    dueAt: '2026-11-01',
    source: 'canvas',
  })
  repos.feedback.add({ scope: 'quizzes', subjectId: null, text: 'Your quizzes are too easy' })
  repos.chat.append({ thread: 'ask', role: 'user', content: 'Where was I?', actions: [] })
  repos.episodes.save({
    id: 'ep_1',
    bundleId: 'com.apple.Safari',
    app: 'Safari',
    title: 'Causal',
    url: 'https://ex.org/a?session=secret',
    kind: 'reading',
    aiProvider: null,
    startedAt: '2026-10-25T07:00:00.000Z',
    endedAt: '2026-10-25T07:10:00.000Z',
    dwellSeconds: 600,
    text: 'lorem ipsum '.repeat(500),
    source: 'ax',
    signals: {
      readingWpm: null,
      baselineWpm: null,
      scrollBacks: 0,
      revisitsToday: 0,
      searches: [],
      aiQuestions: [],
      highlights: ['a marked passage'],
    },
    extracted: true,
  })
  const queries = createQueryService({ repos, clock, greetingName: 'Ilari' })
  const tools = createReadTools({
    repos,
    queries,
    memory: createMemoryControl(repos),
    study: { current: () => session },
    nowIso: () => NOW,
  })
  const tool = (name: string) => tools.find((t) => t.name === name) as ChatTool
  const read = async (input: Partial<ReadInput> & Pick<ReadInput, 'kind'>) => {
    const parsed = ReadInput.parse({
      id: null,
      subjectId: null,
      conceptId: null,
      limit: null,
      ...input,
    })
    return (await tool('read').run(parsed, {})) as ToolOutcome
  }
  // biome-ignore lint/suspicious/noExplicitAny: results are untyped JSON for the model
  const ok = async (input: Parameters<typeof read>[0]): Promise<any> => {
    const out = await read(input)
    expect(out.ok, JSON.stringify(out.result)).toBe(true)
    return out.result
  }
  return { repos, tools, tool, read, ok, stats, old, causal, noise, note, loose, encounter }
}

describe('read', () => {
  it('lists every subject with status and open roadmaps', async () => {
    const { ok, stats, old } = world()
    const r = await ok({ kind: 'subjects' })
    expect(r.subjects.map((s: { status: string }) => s.status)).toEqual([
      'active',
      'suggested',
      'archived',
    ])
    const s = r.subjects.find((x: { id: string }) => x.id === stats.id)
    expect(s.goal).toBe('Pass the exam')
    expect(s.description.length).toBeLessThanOrEqual(160)
    expect(s.openRoadmaps).toEqual([
      {
        id: 'rdm_causal',
        title: 'Causal Inference and Functional Noise Models',
        status: 'paused',
        progress: 'step 3 of 6, 2 done',
      },
    ])
    expect(r.subjects.some((x: { id: string }) => x.id === old.id)).toBe(true)
  })

  it('reads a subject: preferences, topic tree, roadmaps, assignments, exams', async () => {
    const { ok, stats, causal, noise } = world()
    const r = await ok({ kind: 'subject', id: stats.id })
    expect(r.subject.id).toBe(stats.id)
    expect(r.studyPreferences.focus).toEqual([{ id: noise.id, name: 'Additive Noise Models' }])
    expect(r.topics).toEqual([
      expect.objectContaining({
        id: causal.id,
        depth: 0,
        bigPicture: 'Telling cause from correlation',
      }),
      expect.objectContaining({ id: noise.id, parentId: causal.id, depth: 1, gap: true, notes: 1 }),
    ])
    expect(r.topics[1].sources).toEqual([{ title: 'Causal', url: 'https://ex.org/causal' }])
    expect(r.prerequisites).toEqual(['Causal Inference → Additive Noise Models'])
    expect(r.roadmaps.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([
      ['rdm_causal', 'paused'],
      ['rdm_old', 'done'],
    ])
    expect(r.assignments[0].title).toBe('Problem set 3')
    expect(r.recentExams.map((q: { id: string }) => q.id)).toEqual(['qz_1'])
  })

  it('reads a topic: big picture, parent, subtopics, notes, sources, prerequisites', async () => {
    const { ok, causal, noise, note } = world()
    const parent = await ok({ kind: 'topic', id: causal.id })
    expect(parent.topic.bigPicture).toBe('Telling cause from correlation')
    expect(parent.subtopics).toEqual([
      { id: noise.id, name: 'Additive Noise Models', status: 'struggling' },
    ])
    expect(parent.leadsTo).toEqual([{ id: noise.id, name: 'Additive Noise Models' }])
    expect(parent.recentEncounters).toHaveLength(1)
    const child = await ok({ kind: 'topic', id: noise.id })
    expect(child.parent).toEqual({ id: causal.id, name: 'Causal Inference' })
    expect(child.notes.map((n: { id: string }) => n.id)).toEqual([note.id])
    expect(child.prerequisites).toEqual([
      { id: causal.id, name: 'Causal Inference', why: 'builds on it' },
    ])
    expect(child.topic.gap).toBe(true)
  })

  it('reads notes by topic, by subject, loose, and one note', async () => {
    const { ok, stats, noise, note, loose } = world()
    expect((await ok({ kind: 'notes', conceptId: noise.id })).notes[0].id).toBe(note.id)
    expect((await ok({ kind: 'notes', subjectId: stats.id })).notes[0].id).toBe(note.id)
    const looseNotes = await ok({ kind: 'notes' })
    expect(looseNotes.scope).toBe('loose')
    expect(looseNotes.notes.map((n: { id: string }) => n.id)).toEqual([loose.id])
    expect((await ok({ kind: 'note', id: note.id })).note.text).toBe(
      'Thinks noise must be Gaussian',
    )
  })

  it('shows a paused roadmap at step 3 of 6 in roadmaps and roadmap, with its current step', async () => {
    const { ok, stats } = world()
    const list = await ok({ kind: 'roadmaps', subjectId: stats.id })
    const paused = list.roadmaps[0]
    expect(paused).toMatchObject({
      id: 'rdm_causal',
      status: 'paused',
      progress: 'step 3 of 6, 2 done',
      current: { id: 'item_2', n: 3, title: 'Checkpoint 1 · 3 questions' },
    })
    expect(paused.steps).toHaveLength(6)
    expect(list.roadmaps[1]).toMatchObject({ id: 'rdm_old', status: 'done' })
    // Every subject's roadmaps when no subject is given.
    expect((await ok({ kind: 'roadmaps' })).roadmaps).toHaveLength(2)

    const one = await ok({ kind: 'roadmap', id: 'rdm_causal' })
    expect(one.roadmap.subjectName).toBe('Statistics')
    expect(one.roadmap.steps.map((s: { status: string }) => s.status)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ])
    expect(one.roadmap.steps[2]).toMatchObject({
      id: 'item_2',
      n: 3,
      kind: 'checkpoint',
      covers: ['Causal Inference'],
    })
    expect(one.roadmap.steps[3]).toMatchObject({
      kind: 'learn',
      objective: 'Understand Heteroskedastic and Post-Nonlinear Models',
    })
    expect(one.roadmap.carry).toEqual(['Additive Noise Models'])
  })

  it('reads quizzes, exams and one quiz with the student answers', async () => {
    const { ok, stats } = world()
    const quizzes = await ok({ kind: 'quizzes', subjectId: stats.id })
    expect(quizzes.quizzes.map((q: { id: string }) => q.id).sort()).toEqual(['qz_1', 'qz_cp'])
    const exams = await ok({ kind: 'exams' })
    expect(exams.exams.map((q: { id: string }) => q.id)).toEqual(['qz_1'])
    const quiz = await ok({ kind: 'quiz', id: 'qz_1' })
    expect(quiz.quiz.questions[0]).toMatchObject({
      id: 'q_1',
      correctIndex: 2,
      chosenIndex: 1,
      correct: false,
      why: 'yes, it causes both',
    })
    expect(quiz.quiz.score).toBe(0)
  })

  it('reads gaps: struggling topics, misconceptions, open questions, roadmap carry', async () => {
    const { ok, stats, noise, note } = world()
    for (const subjectId of [stats.id, null]) {
      const r = await ok({ kind: 'gaps', subjectId })
      expect(r.struggling.map((c: { id: string }) => c.id)).toEqual([noise.id])
      expect(r.notes.map((n: { id: string }) => n.id)).toEqual([note.id])
      expect(r.openQuestions[0].question).toBe('What is a collider?')
      expect(r.roadmapCarry).toEqual([
        { roadmapId: 'rdm_causal', subjectId: stats.id, concepts: ['Additive Noise Models'] },
      ])
    }
  })

  it('reads encounters, episodes (clipped, no query strings), assignments, feedback, chat, profile', async () => {
    const { ok, stats, encounter } = world()
    const encounters = await ok({ kind: 'encounters', subjectId: stats.id })
    expect(encounters.encounters[0]).toMatchObject({ id: encounter.id, understanding: 'unclear' })
    expect(encounters.encounters[0].source.url).toBe('https://ex.org/causal')
    expect((await ok({ kind: 'encounter', id: encounter.id })).encounter.evidence).toBe(
      'reread twice',
    )
    const episodes = await ok({ kind: 'episodes' })
    expect(episodes.episodes[0].id).toBe('ep_1')
    expect(episodes.episodes[0].text.length).toBeLessThanOrEqual(600)
    expect(episodes.episodes[0].url).toBe('https://ex.org/a')
    expect(episodes.episodes[0].highlights).toEqual(['a marked passage'])
    expect((await ok({ kind: 'assignments' })).assignments[0]).toMatchObject({
      title: 'Problem set 3',
      dueAt: '2026-11-01',
      status: 'open',
    })
    expect((await ok({ kind: 'feedback' })).feedback[0].text).toBe('Your quizzes are too easy')
    const chat = await ok({ kind: 'chat' })
    expect(chat.thread).toBe('ask')
    expect(chat.messages[0]).toMatchObject({ role: 'user', content: 'Where was I?' })
    expect((await ok({ kind: 'profile' })).profile.promptLanguage).toBe('auto')
    expect((await ok({ kind: 'nudges' })).nudges).toEqual([])
  })

  it('reads the study session, or none', async () => {
    expect((await world().ok({ kind: 'session' })).session).toBeNull()
    const session: SessionState = {
      roadmapId: 'rdm_causal',
      subjectId: 'sub_x',
      subjectName: 'Statistics',
      subjectEmoji: '📊',
      title: 'Causal Inference',
      phase: 'checkpoint',
      index: 2,
      total: 6,
      items: [item(0, 'a', 'done'), item(1, 'b', 'done'), item(2, 'Checkpoint 1', 'current')],
      nextAction: 'open_quiz',
      assistant: 'ChatGPT',
      startReason: '',
      offerPlacement: false,
      error: null,
    }
    const r = await world(session).ok({ kind: 'session' })
    expect(r.session).toMatchObject({
      roadmapId: 'rdm_causal',
      step: '3 of 6',
      current: { id: 'item_2', title: 'Checkpoint 1' },
    })
  })

  it('settings carry no secret-ish fields', async () => {
    const { repos, ok } = world()
    repos.settings.update({
      ai: {
        geminiKeySet: true,
        groqKeySet: false,
        mistralKeySet: false,
        useOnDevice: true,
        modelOverrides: { fast: 'gemini:gemini-3.5-flash' },
        apiKey: 'AIzaSyD-not-a-real-key',
      } as Settings['ai'],
    })
    const r = await ok({ kind: 'settings' })
    const text = JSON.stringify(r)
    expect(text).not.toMatch(/apiKey|AIza|modelOverrides|gemini-3\.5|secret|token/i)
    expect(r.settings.ai.geminiKeySet).toBe(true)
    expect(r.settings.captureEnabled).toBe(true)
    expect(
      withoutSecrets({
        authToken: 'x',
        nested: [{ password: 'p', ok: 1 }],
        v: 'sk-abc',
        key: 'fn',
      }),
    ).toEqual({ nested: [{ ok: 1 }], key: 'fn' })
  })

  it('fails cleanly on unknown or missing ids', async () => {
    const { read } = world()
    const cases: [Parameters<typeof read>[0], string][] = [
      [{ kind: 'subject', id: 'sub_nope' }, 'No subject with id sub_nope; read subjects first'],
      [{ kind: 'topic', id: 'cpt_nope' }, 'No topic with id cpt_nope'],
      [{ kind: 'roadmap', id: 'rdm_nope' }, 'No roadmap with id rdm_nope; read roadmaps first'],
      [{ kind: 'quiz', id: 'qz_nope' }, 'No quiz with id qz_nope; read quizzes first'],
      [{ kind: 'note', id: 'nte_nope' }, 'No note with id nte_nope; read notes first'],
      [{ kind: 'encounter', id: 'enc_nope' }, 'No encounter with id enc_nope'],
      [{ kind: 'notes', subjectId: 'sub_nope' }, 'No subject with id sub_nope'],
      [{ kind: 'roadmaps', subjectId: 'sub_nope' }, 'No subject with id sub_nope'],
      [{ kind: 'roadmap' }, 'read roadmap needs an id; read roadmaps first'],
    ]
    for (const [input, error] of cases) {
      const out = await read(input)
      expect(out.ok).toBe(false)
      expect((out.result as { error: string }).error).toContain(error)
      expect(out.receipts).toEqual([])
    }
  })

  it('keeps results small: long text clipped, lists capped by limit', async () => {
    const { repos, ok, stats } = world()
    for (let i = 0; i < 70; i++)
      repos.notes.add({
        subjectId: stats.id,
        conceptId: null,
        encounterId: null,
        kind: 'fact',
        text: `Fact number ${i} ${'blah '.repeat(60)}`,
        source: SRC,
      })
    const dflt = await ok({ kind: 'notes', subjectId: stats.id })
    expect(dflt.notes).toHaveLength(20)
    const total = repos.notes.list({ subjectId: stats.id }).length
    expect(total).toBeGreaterThan(50)
    expect(dflt.notesMore).toBe(total - 20)
    const max = await ok({ kind: 'notes', subjectId: stats.id, limit: 500 })
    expect(max.notes).toHaveLength(50)
    expect(max.notes.every((n: { text: string }) => n.text.length <= 200)).toBe(true)
    expect(JSON.stringify(max).length).toBeLessThan(20000)
    expect(JSON.stringify(await ok({ kind: 'subject', id: stats.id })).length).toBeLessThan(4000)
  })
})

describe('search', () => {
  it('returns hits with kind, id, title, snippet and subjectId', async () => {
    const { tool, causal, stats } = world()
    const out = (await tool('search').run({ query: 'causal', limit: null }, {})) as ToolOutcome
    expect(out.ok).toBe(true)
    const hits = (out.result as { hits: { kind: string; id: string; subjectId: string }[] }).hits
    expect(hits).toContainEqual(
      expect.objectContaining({ kind: 'concept', id: causal.id, subjectId: stats.id }),
    )
    expect(Object.keys(hits[0] ?? {})).toEqual(['kind', 'id', 'title', 'snippet', 'subjectId'])
  })

  it('both tools have strict-schema inputs: every property required, nullable not optional', () => {
    const { tools } = world()
    expect(tools.map((t) => t.name)).toEqual(['read', 'search'])
    for (const t of tools) {
      const shape = (t.input as unknown as { shape: Record<string, { isOptional(): boolean }> })
        .shape
      for (const field of Object.values(shape)) expect(field.isOptional()).toBe(false)
    }
  })
})
