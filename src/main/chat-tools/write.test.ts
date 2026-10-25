import { toProviderSchema } from '@engine/brain/llm/json'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { createEngineBus } from '@engine/events'
import { encounterInput, quiz } from '@engine/store/conformance/fixtures'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { CheckpointItem, Id, LearnItem, Roadmap } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import { describe, expect, it } from 'vitest'
import type { ChatTool, ToolCtx, ToolOutcome } from './types'
import { UndoLog } from './undo'
import { createWriteTools } from './write'

const SOURCE = { app: 'Chrome', bundleId: null, url: null, title: 'Page' }

/** Mirrors SqliteConceptRepo.moveToSubject on the in-memory twin. */
function fakeRelink(repos: Repos) {
  const encounterLinks: [Id, Id | null][] = []
  return {
    encounterLinks,
    moveConcept(conceptId: Id, subjectId: Id) {
      const c = repos.concepts.get(conceptId)
      if (!c || c.subjectId === subjectId) return
      for (const e of repos.edges.list(c.subjectId))
        if (e.fromId === conceptId || e.toId === conceptId) repos.edges.remove(e.fromId, e.toId)
      for (const child of repos.concepts.listBySubject(c.subjectId))
        if (child.parentId === conceptId) repos.concepts.update(child.id, { parentId: c.parentId })
      repos.concepts.update(conceptId, { subjectId, parentId: null } as never)
      for (const n of repos.notes.list({ conceptId, status: null }))
        repos.notes.update(n.id, { subjectId })
    },
    setEncounterConcept(encounterId: Id, conceptId: Id | null) {
      encounterLinks.push([encounterId, conceptId])
    },
  }
}

function setup(opts: { relink?: boolean } = {}) {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const memory: MemoryChanged[] = []
  const settingsEvents: unknown[] = []
  bus.on('memory:changed', (e) => memory.push(e))
  bus.on('settings:changed', (e) => settingsEvents.push(e.settings))
  const undo = new UndoLog()
  const relink = fakeRelink(repos)
  const tools = createWriteTools({
    repos,
    bus,
    undo,
    relink: opts.relink === false ? null : relink,
    nowIso: () => clock.nowIso(),
  })
  const call = async (name: string, input: unknown, ctx: ToolCtx = {}): Promise<ToolOutcome> => {
    const tool = tools.find((t) => t.name === name) as ChatTool
    return tool.run(tool.input.parse(input), ctx)
  }
  const create = (kind: string, data: unknown) =>
    call('create', { kind, data: typeof data === 'string' ? data : JSON.stringify(data) })
  const update = (kind: string, id: Id | null, patch: unknown) =>
    call('update', { kind, id, patch: JSON.stringify(patch) })
  const remove = (kind: string, id: Id, confirmed = false) =>
    call('delete', { kind, id }, { confirmed })
  const undoLast = async (out: ToolOutcome) => {
    const id = out.receipts[0]?.undoId
    expect(id).toBeTruthy()
    expect(await undo.undo(id as string)).toBe(true)
  }
  /** Everything the tools can touch, for "Undo restores the exact previous state". */
  const state = () => {
    const subjects = repos.subjects.list()
    return {
      subjects,
      // Sorted: a restored row may come back at the end of the table.
      concepts: subjects
        .flatMap((s) => repos.concepts.listBySubject(s.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
      notes: [
        ...subjects.flatMap((s) => repos.notes.list({ subjectId: s.id, status: null })),
        ...repos.notes.list({ subjectId: null, status: null }),
      ],
      edges: subjects.flatMap((s) => repos.edges.list(s.id)),
      roadmaps: subjects.flatMap((s) => repos.roadmaps.listBySubject(s.id)),
      quizzes: repos.quizzes.list({}),
      feedback: repos.feedback.recent({ limit: 100 }),
      assignments: repos.assignments.list({}),
      settings: repos.settings.get(),
      profile: repos.profile.get(),
    }
  }
  return {
    clock,
    repos,
    memory,
    settingsEvents,
    relink,
    tools,
    call,
    create,
    update,
    remove,
    undoLast,
    state,
  }
}

const result = (out: ToolOutcome) => out.result as Record<string, unknown>
const error = (out: ToolOutcome) => String((out.result as { error: string }).error)

function learn(idx: number, title: string, status: LearnItem['status'] = 'todo'): LearnItem {
  return {
    kind: 'learn',
    id: `itm_${idx}`,
    idx,
    title,
    objective: `understand ${title}`,
    concepts: [title],
    move: 'intuition',
    promptDraft: '',
    promptSent: status === 'current' ? 'sent' : null,
    status,
  }
}

function checkpoint(idx: number): CheckpointItem {
  return {
    kind: 'checkpoint',
    id: `itm_${idx}`,
    idx,
    title: 'Checkpoint 1',
    covers: ['Mean'],
    probes: [],
    nQuestions: 3,
    quizId: null,
    score: null,
    status: 'todo',
  }
}

function roadmap(subjectId: Id, over: Partial<Roadmap> = {}): Roadmap {
  return {
    id: 'rdm_1',
    subjectId,
    title: 'Descriptive statistics',
    goal: 'Pass the midterm',
    startReason: '',
    offerPlacement: false,
    estimatedMinutes: 40,
    status: 'active',
    items: [learn(0, 'Mean', 'current'), learn(1, 'Median'), checkpoint(2), learn(3, 'Variance')],
    carry: [],
    nextMilestone: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    ...over,
  }
}

const statuses = (r: Roadmap | null) => r?.items.map((i) => `${i.idx}:${i.title}:${i.status}`)

describe('write tools: schemas', () => {
  it('exposes create, update and delete with every field required (strict JSON schema)', () => {
    const { tools } = setup()
    expect(tools.map((t) => t.name)).toEqual(['create', 'update', 'delete'])
    for (const tool of tools) {
      const schema = toProviderSchema(tool.input) as {
        properties: Record<string, { type: unknown }>
        required: string[]
      }
      expect(schema.required).toEqual(Object.keys(schema.properties))
    }
    const update = toProviderSchema(tools[1]?.input as ChatTool['input']) as {
      properties: Record<string, { type: unknown }>
    }
    expect(update.properties.patch?.type).toBe('string')
    expect(JSON.stringify(update.properties.id)).toMatch(/"null"/)
  })

  it('parses data leniently: an object, fenced JSON; fails on anything else', async () => {
    const t = setup()
    const asObject = await t.call('create', { kind: 'subject', data: { name: 'Statistics' } })
    expect(asObject.ok).toBe(true)
    const fenced = await t.create('subject', '```json\n{"name":"Biology"}\n```')
    expect(fenced.ok).toBe(true)
    const bad = await t.create('subject', 'name: Physics')
    expect(bad.ok).toBe(false)
    expect(error(bad)).toMatch(/JSON object/)
    const list = await t.create('subject', '[1,2]')
    expect(list.ok).toBe(false)
  })
})

describe('write tools: subject', () => {
  it('creates a subject; Undo removes it', async () => {
    const t = setup()
    const before = t.state()
    const out = await t.create('subject', { name: 'Statistics', goal: 'Pass the exam' })
    expect(out.ok).toBe(true)
    expect(out.receipts[0]?.line).toBe('Created subject “Statistics”')
    const id = result(out).id as Id
    expect(t.repos.subjects.get(id)?.goal).toBe('Pass the exam')
    expect(t.memory).toContainEqual({ scope: 'subjects', ids: [id] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('an existing name is not created twice', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const out = await t.create('subject', { name: ' statistics ' })
    expect(out.ok).toBe(true)
    expect(result(out)).toMatchObject({ alreadyExists: true, subject: { id: s.id } })
    expect(out.receipts).toEqual([])
  })

  it('updates name, goal and deadline with one receipt; Undo restores them', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Stats', goal: 'Learn it' })
    const before = t.state()
    const out = await t.update('subject', s.id, {
      name: 'Statistics',
      goal: 'Pass the midterm',
      deadline: '2026-12-12',
    })
    expect(out.receipts[0]?.line).toBe(
      'Renamed “Stats” → “Statistics” · Saved to Statistics: goal “Pass the midterm”, deadline 12 Dec 2026',
    )
    expect(t.repos.subjects.get(s.id)).toMatchObject({ name: 'Statistics', deadline: '2026-12-12' })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('refuses bad dates, unknown fields, unknown ids and deletes', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Stats' })
    const date = await t.update('subject', s.id, { deadline: '2026-02-30' })
    expect(error(date)).toMatch(/deadline: must be a date YYYY-MM-DD/)
    const field = await t.update('subject', s.id, { colour: 'red' })
    expect(error(field)).toMatch(/subject has no field colour; allowed: name, emoji, description/)
    const unknown = await t.update('subject', 'sub_nope', { name: 'X' })
    expect(error(unknown)).toBe('No subject with id sub_nope; read first')
    const del = await t.remove('subject', s.id, true)
    expect(del.ok).toBe(false)
    expect(error(del)).toMatch(/subject page/)
    expect(t.repos.subjects.get(s.id)).not.toBeNull()
  })
})

describe('write tools: topic', () => {
  it('creates a topic under a parent with a pinned big picture; Undo removes it', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const parent = t.repos.concepts.upsert({ subjectId: s.id, name: 'Probability' })
    const before = t.state()
    const out = await t.create('topic', {
      subjectId: s.id,
      name: 'Bayes theorem',
      parentId: parent.id,
      summary: 'Updating beliefs with evidence',
    })
    expect(out.receipts[0]?.line).toBe(
      'Added topic “Bayes theorem” to Statistics under “Probability”',
    )
    const made = t.repos.concepts.get(result(out).id as Id)
    expect(made).toMatchObject({ parentId: parent.id, summaryPinned: true })
    expect(t.memory).toContainEqual({ scope: 'concepts', ids: [made?.id] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('renames, pins a new big picture and marks a status; Undo restores the row', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const c = t.repos.concepts.upsert({ subjectId: s.id, name: 'Mean', summary: 'average' })
    const before = t.state()
    const out = await t.update('topic', c.id, {
      name: 'Arithmetic mean',
      summary: 'The balance point of the data',
      status: 'struggling',
    })
    expect(out.receipts[0]?.line).toBe(
      'Renamed “Mean” → “Arithmetic mean” · Big picture of “Arithmetic mean” updated · Marked “Arithmetic mean” as struggling',
    )
    expect(t.repos.concepts.get(c.id)).toMatchObject({
      name: 'Arithmetic mean',
      summaryPinned: true,
      status: 'struggling',
    })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
    expect(t.repos.concepts.get(c.id)?.summaryPinned).toBeUndefined()
  })

  it('re-parents a topic but never under its own subtopic', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const top = t.repos.concepts.upsert({ subjectId: s.id, name: 'Probability' })
    const child = t.repos.concepts.upsert({
      subjectId: s.id,
      name: 'Bayes',
      parentName: 'Probability',
    })
    const cycle = await t.update('topic', top.id, { parentId: child.id })
    expect(error(cycle)).toMatch(/under itself or its own subtopics/)
    const out = await t.update('topic', child.id, { parentId: null })
    expect(out.receipts[0]?.line).toBe('Made “Bayes” a main topic')
    expect(t.repos.concepts.get(child.id)?.parentId).toBeNull()
  })

  it('moves a topic with its subtopics and notes to another subject; Undo moves it back', async () => {
    const t = setup()
    const math = t.repos.subjects.create({ name: 'Math' })
    const stats = t.repos.subjects.create({ name: 'Statistics' })
    const prob = t.repos.concepts.upsert({ subjectId: math.id, name: 'Probability' })
    const bayes = t.repos.concepts.upsert({
      subjectId: math.id,
      name: 'Bayes',
      parentName: 'Probability',
    })
    const algebra = t.repos.concepts.upsert({ subjectId: math.id, name: 'Algebra' })
    t.repos.edges.add({ fromId: algebra.id, toId: prob.id, why: 'needs fractions' })
    t.repos.edges.add({ fromId: prob.id, toId: bayes.id, why: 'builds on it' })
    t.repos.notes.add({
      subjectId: math.id,
      conceptId: bayes.id,
      encounterId: null,
      kind: 'formula',
      text: 'P(A|B) = P(B|A)P(A)/P(B)',
      source: SOURCE,
    })
    const before = t.state()
    const out = await t.update('topic', prob.id, { subjectId: stats.id })
    expect(out.ok).toBe(true)
    expect(out.receipts[0]?.line).toBe('Moved “Probability” to Statistics with 1 subtopic')
    expect(t.repos.concepts.get(prob.id)).toMatchObject({ subjectId: stats.id, parentId: null })
    expect(t.repos.concepts.get(bayes.id)).toMatchObject({
      subjectId: stats.id,
      parentId: prob.id,
    })
    expect(t.repos.notes.list({ subjectId: stats.id }).map((n) => n.conceptId)).toEqual([bayes.id])
    expect(t.repos.edges.list(math.id)).toEqual([])
    expect(t.repos.edges.list(stats.id).map((e) => [e.fromId, e.toId, e.why])).toEqual([
      [prob.id, bayes.id, 'builds on it'],
    ])
    expect(t.memory).toContainEqual({ scope: 'subjects', ids: [math.id, stats.id] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('a move fails cleanly without relink or with a name clash', async () => {
    const t = setup({ relink: false })
    const a = t.repos.subjects.create({ name: 'Math' })
    const b = t.repos.subjects.create({ name: 'Statistics' })
    const c = t.repos.concepts.upsert({ subjectId: a.id, name: 'Mean' })
    const noRelink = await t.update('topic', c.id, { subjectId: b.id })
    expect(error(noRelink)).toMatch(/not available/)

    const u = setup()
    const x = u.repos.subjects.create({ name: 'Math' })
    const y = u.repos.subjects.create({ name: 'Statistics' })
    const m = u.repos.concepts.upsert({ subjectId: x.id, name: 'Mean' })
    u.repos.concepts.upsert({ subjectId: y.id, name: 'mean' })
    const clash = await u.update('topic', m.id, { subjectId: y.id })
    expect(error(clash)).toMatch(/Statistics already has a topic “mean”/)
    expect(u.repos.concepts.get(m.id)?.subjectId).toBe(x.id)
  })

  it('delete asks first, then deletes; Undo restores the topic and everything linked to it', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const top = t.repos.concepts.upsert({ subjectId: s.id, name: 'Descriptive' })
    const mid = t.repos.concepts.upsert({
      subjectId: s.id,
      name: 'Spread',
      parentName: 'Descriptive',
    })
    const leaf = t.repos.concepts.upsert({
      subjectId: s.id,
      name: 'Variance',
      parentName: 'Spread',
    })
    const other = t.repos.concepts.upsert({ subjectId: s.id, name: 'Mean' })
    t.repos.edges.add({ fromId: other.id, toId: mid.id, why: 'spread is around the mean' })
    t.repos.concepts.update(mid.id, { summaryPinned: true, mastery: 0.4 })
    const enc = t.repos.encounters.add(encounterInput({ subjectId: s.id, conceptId: mid.id }))
    for (const text of ['Range is max minus min', 'IQR ignores outliers'])
      t.repos.notes.add({
        subjectId: s.id,
        conceptId: mid.id,
        encounterId: null,
        kind: 'fact',
        text,
        source: SOURCE,
      })
    const q = quiz({ id: 'quz_9', subjectIds: [s.id] })
    q.questions = q.questions.map((x, i) => (i === 0 ? { ...x, conceptId: mid.id } : x))
    t.repos.quizzes.save(q)
    const before = t.state()

    const ask = await t.remove('topic', mid.id)
    expect(ask.ok).toBe(true)
    expect(ask.result).toEqual({
      needsConfirmation: true,
      message: 'Ask the student to press the confirmation button',
    })
    expect(ask.chips).toEqual([
      {
        type: 'run_tool',
        tool: 'delete',
        input: { kind: 'topic', id: mid.id },
        label: 'Delete topic “Spread” and its 2 notes',
      },
    ])
    expect(ask.receipts).toEqual([])
    expect(t.state()).toEqual(before)

    const out = await t.remove('topic', mid.id, true)
    expect(out.receipts[0]?.line).toBe('Deleted topic “Spread” and its 2 notes')
    expect(t.repos.concepts.get(mid.id)).toBeNull()
    expect(t.repos.concepts.get(leaf.id)?.parentId).toBe(top.id)
    expect(t.repos.notes.list({ subjectId: s.id })).toEqual([])
    expect(t.memory).toContainEqual({ scope: 'subjects', ids: [s.id] })

    await t.undoLast(out)
    expect(t.state()).toEqual(before)
    expect(t.relink.encounterLinks).toEqual([[enc.id, mid.id]])
  })
})

describe('write tools: note', () => {
  it('creates a pinned note on a topic; Undo soft-deletes it', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const c = t.repos.concepts.upsert({ subjectId: s.id, name: 'Mean' })
    const activeBefore = t.repos.notes.list({ subjectId: s.id })
    const out = await t.create('note', { conceptId: c.id, text: 'The mean is pulled by outliers' })
    expect(out.receipts[0]?.line).toBe(
      'Saved to Statistics › Mean: “The mean is pulled by outliers”',
    )
    const note = t.repos.notes.get(result(out).id as Id)
    expect(note).toMatchObject({ subjectId: s.id, conceptId: c.id, pinned: true, kind: 'fact' })
    expect(t.memory).toContainEqual({ scope: 'subjects', ids: [s.id] })
    expect(t.memory).toContainEqual({ scope: 'concepts', ids: [c.id] })
    await t.undoLast(out)
    expect(t.repos.notes.list({ subjectId: s.id })).toEqual(activeBefore)
    expect(t.repos.notes.get(note?.id as Id)?.status).toBe('deleted')
  })

  it('refuses notes that are too long, misplaced or have no place', async () => {
    const t = setup()
    const a = t.repos.subjects.create({ name: 'Statistics' })
    const b = t.repos.subjects.create({ name: 'Biology' })
    const c = t.repos.concepts.upsert({ subjectId: a.id, name: 'Mean' })
    expect(error(await t.create('note', { subjectId: a.id, text: 'x'.repeat(201) }))).toMatch(
      /text: at most 200 characters/,
    )
    expect(error(await t.create('note', { text: 'Loose' }))).toMatch(/Say where the note goes/)
    expect(
      error(await t.create('note', { subjectId: b.id, conceptId: c.id, text: 'Wrong place' })),
    ).toMatch(/another subject/)
  })

  it('edits (pins), re-kinds and files a note; Undo restores it exactly', async () => {
    const t = setup()
    const a = t.repos.subjects.create({ name: 'Statistics' })
    const b = t.repos.subjects.create({ name: 'Biology' })
    const cell = t.repos.concepts.upsert({ subjectId: b.id, name: 'Cell' })
    const { note } = t.repos.notes.add({
      subjectId: a.id,
      conceptId: null,
      encounterId: null,
      kind: 'fact',
      text: 'cells divide by mitosis',
      source: SOURCE,
    })
    const before = t.state()
    const out = await t.update('note', note.id, {
      text: 'Cells divide by mitosis',
      kind: 'definition',
      conceptId: cell.id,
    })
    expect(out.receipts[0]?.line).toBe(
      'Edited note “Cells divide by mitosis” · Note “Cells divide by mitosis” is now a definition · Filed note “Cells divide by mitosis” under Biology › Cell',
    )
    expect(t.repos.notes.get(note.id)).toMatchObject({
      subjectId: b.id,
      conceptId: cell.id,
      pinned: true,
      kind: 'definition',
    })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('delete asks first, then soft-deletes; Undo brings it back', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const { note } = t.repos.notes.add({
      subjectId: s.id,
      conceptId: null,
      encounterId: null,
      kind: 'fact',
      text: 'Median resists outliers',
      source: SOURCE,
    })
    const before = t.state()
    const ask = await t.remove('note', note.id)
    expect(ask.chips[0]).toMatchObject({
      type: 'run_tool',
      label: 'Delete note “Median resists outliers”',
    })
    expect(t.repos.notes.get(note.id)?.status).toBe('active')
    const out = await t.remove('note', note.id, true)
    expect(out.receipts[0]?.line).toBe('Deleted note “Median resists outliers”')
    expect(t.repos.notes.get(note.id)?.status).toBe('deleted')
    const again = await t.remove('note', note.id, true)
    expect(error(again)).toBe(`No note with id ${note.id}; read first`)
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })
})

describe('write tools: roadmap', () => {
  it('renames and activates a roadmap, pausing the subject’s other active one; Undo restores both', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    t.repos.roadmaps.save(roadmap(s.id))
    t.repos.roadmaps.save(roadmap(s.id, { id: 'rdm_2', title: 'Inference', status: 'paused' }))
    const before = t.state()
    const out = await t.update('roadmap', 'rdm_2', { title: 'Inference basics', status: 'active' })
    expect(out.receipts[0]?.line).toBe(
      'Renamed roadmap “Inference” → “Inference basics” · Resumed roadmap “Inference basics” · paused “Descriptive statistics”',
    )
    expect(t.repos.roadmaps.get('rdm_1')?.status).toBe('paused')
    expect(t.repos.roadmaps.get('rdm_2')?.status).toBe('active')
    expect(t.memory).toContainEqual({ scope: 'roadmaps', ids: ['rdm_2', 'rdm_1'] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('refuses create and delete, pointing at act', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    t.repos.roadmaps.save(roadmap(s.id))
    expect(error(await t.create('roadmap', { title: 'X' }))).toMatch(/start_roadmap/)
    expect(error(await t.remove('roadmap', 'rdm_1', true))).toMatch(/never deleted/)
    expect(t.repos.roadmaps.get('rdm_1')).not.toBeNull()
  })
})

describe('write tools: roadmap_step', () => {
  const withRoadmap = () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    t.repos.roadmaps.save(roadmap(s.id))
    return { ...t, subject: s, get: () => t.repos.roadmaps.get('rdm_1') }
  }

  it('marking the current step done makes the next one current; Undo restores the roadmap', async () => {
    const t = withRoadmap()
    const before = t.state()
    const out = await t.update('roadmap_step', 'itm_0', { status: 'done' })
    expect(out.receipts[0]?.line).toBe('Marked step 1 “Mean” done')
    expect(statuses(t.get())).toEqual([
      '0:Mean:done',
      '1:Median:current',
      '2:Checkpoint 1:todo',
      '3:Variance:todo',
    ])
    expect(result(out)).toMatchObject({ currentStep: 2, roadmapStatus: 'active' })
    expect(t.memory).toContainEqual({ scope: 'roadmaps', ids: ['rdm_1'] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('closing the last open step finishes the roadmap; reopening one un-finishes it', async () => {
    const t = withRoadmap()
    for (const id of ['itm_0', 'itm_1', 'itm_2'])
      await t.update('roadmap_step', id, { status: 'done' })
    const last = await t.update('roadmap_step', 'itm_3', { status: 'skipped' })
    expect(last.receipts[0]?.line).toBe(
      'Skipped step 4 “Variance” · roadmap “Descriptive statistics” finished',
    )
    expect(t.get()?.status).toBe('done')
    const reopen = await t.update('roadmap_step', 'itm_3', { status: 'todo' })
    expect(reopen.receipts[0]?.line).toBe('Reopened step 4 “Variance”')
    expect(t.get()?.status).toBe('paused')
  })

  it('making another step current leaves exactly one current step', async () => {
    const t = withRoadmap()
    const out = await t.update('roadmap_step', 'itm_3', { status: 'current' })
    expect(out.receipts[0]?.line).toBe('Step 4 “Variance” is now the current step')
    expect(
      t
        .get()
        ?.items.filter((i) => i.status === 'current')
        .map((i) => i.id),
    ).toEqual(['itm_3'])
  })

  it('reorders: idx stays contiguous and statuses stay put; Undo restores the order', async () => {
    const t = withRoadmap()
    const before = t.state()
    const out = await t.update('roadmap_step', 'itm_3', { position: 1 })
    expect(out.receipts[0]?.line).toBe('Moved step 4 “Variance” to position 1')
    expect(statuses(t.get())).toEqual([
      '0:Variance:todo',
      '1:Mean:current',
      '2:Median:todo',
      '3:Checkpoint 1:todo',
    ])
    expect(error(await t.update('roadmap_step', 'itm_3', { position: 9 }))).toMatch(/at most 4/)
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('creates a step at a position; Undo removes it', async () => {
    const t = withRoadmap()
    const before = t.state()
    const out = await t.create('roadmap_step', {
      roadmapId: 'rdm_1',
      title: 'Mode',
      objective: 'can find the most common value',
      position: 2,
    })
    expect(out.receipts[0]?.line).toBe('Added step 2 “Mode” to “Descriptive statistics”')
    expect(statuses(t.get())).toEqual([
      '0:Mean:current',
      '1:Mode:todo',
      '2:Median:todo',
      '3:Checkpoint 1:todo',
      '4:Variance:todo',
    ])
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })

  it('renames a step; a checkpoint has no objective', async () => {
    const t = withRoadmap()
    const out = await t.update('roadmap_step', 'itm_1', { title: 'The median' })
    expect(out.receipts[0]?.line).toBe('Renamed step 2 “Median” → “The median”')
    expect(error(await t.update('roadmap_step', 'itm_2', { objective: 'x' }))).toMatch(
      /checkpoint has no objective/,
    )
    expect(error(await t.update('roadmap_step', 'itm_1', { status: 'finished' }))).toMatch(/status/)
  })

  it('deleting the current step asks first, then the next open step becomes current', async () => {
    const t = withRoadmap()
    const before = t.state()
    const ask = await t.remove('roadmap_step', 'itm_0')
    expect(ask.chips[0]).toMatchObject({ label: 'Delete step 1 “Mean”' })
    expect(t.state()).toEqual(before)
    const out = await t.remove('roadmap_step', 'itm_0', true)
    expect(out.receipts[0]?.line).toBe('Deleted step 1 “Mean”')
    expect(statuses(t.get())).toEqual([
      '0:Median:current',
      '1:Checkpoint 1:todo',
      '2:Variance:todo',
    ])
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
  })
})

describe('write tools: feedback, assignment, settings, profile', () => {
  it('saves feedback (Undo removes it) and deletes it after confirmation (Undo re-adds it)', async () => {
    const t = setup()
    const before = t.state()
    const out = await t.create('feedback', { text: 'Quizzes are too easy', scope: 'quizzes' })
    expect(out.receipts[0]?.line).toBe('Saved feedback: “Quizzes are too easy”')
    await t.undoLast(out)
    expect(t.state()).toEqual(before)

    const f = t.repos.feedback.add({ text: 'Shorter prompts', scope: 'prompts', subjectId: null })
    const ask = await t.remove('feedback', f.id)
    expect(ask.chips[0]).toMatchObject({ label: 'Delete feedback “Shorter prompts”' })
    const del = await t.remove('feedback', f.id, true)
    expect(t.repos.feedback.recent({ limit: 10 })).toEqual([])
    await t.undoLast(del)
    expect(t.repos.feedback.recent({ limit: 10 })).toMatchObject([
      { text: 'Shorter prompts', scope: 'prompts', subjectId: null },
    ])
    expect(error(await t.update('feedback', f.id, { text: 'x' }))).toMatch(/not edited/)
  })

  it('adds an assignment (Undo dismisses it) and updates one (Undo restores it)', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const out = await t.create('assignment', {
      title: 'Problem set 3',
      dueAt: '2026-11-02',
      subjectId: s.id,
    })
    expect(out.receipts[0]?.line).toBe('Added assignment “Problem set 3” (due 2 Nov 2026)')
    const id = result(out).id as Id
    expect(t.memory).toContainEqual({ scope: 'assignments', ids: [id] })
    const before = t.state()
    const done = await t.update('assignment', id, { status: 'done', dueAt: null })
    expect(done.receipts[0]?.line).toBe('Assignment “Problem set 3”: no due date, marked done')
    await t.undoLast(done)
    expect(t.state()).toEqual(before)
    await t.undoLast(out)
    expect(t.repos.assignments.list({ status: 'open' })).toEqual([])
    expect(error(await t.create('assignment', { title: 'X', dueAt: 'tomorrow' }))).toMatch(/dueAt/)
  })

  it('changes only allowlisted settings, announces them, and Undo restores them', async () => {
    const t = setup()
    const s = t.repos.subjects.create({ name: 'Statistics' })
    const before = t.state()
    const out = await t.update('settings', null, { focusSubjectId: s.id, timerMinutes: 45 })
    expect(out.receipts[0]?.line).toBe('Focus set to Statistics · Timer set to 45 min')
    expect(t.settingsEvents).toHaveLength(1)
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
    expect(t.settingsEvents).toHaveLength(2)

    const ai = await t.update('settings', null, { ai: { useOnDevice: false } })
    expect(error(ai)).toMatch(
      /settings has no field ai; allowed: focusSubjectId.*only by the student/,
    )
    const capture = await t.update('settings', null, { captureEnabled: false })
    expect(capture.ok).toBe(false)
    expect(error(await t.update('settings', null, { focusSubjectId: 'sub_x' }))).toMatch(
      /No subject with id sub_x/,
    )
    expect(t.repos.settings.get()).toEqual(before.settings)
  })

  it('updates the profile; Undo restores it', async () => {
    const t = setup()
    const before = t.state()
    const out = await t.update('profile', null, { level: 'first-year BSc', promptLanguage: 'fi' })
    expect(out.receipts[0]?.line).toBe('Level set to “first-year BSc” · Prompt language: Finnish')
    expect(t.memory).toContainEqual({ scope: 'profile', ids: ['level', 'promptLanguage'] })
    await t.undoLast(out)
    expect(t.state()).toEqual(before)
    expect(error(await t.update('profile', null, { summary: 'x' }))).toMatch(/allowed: aboutMe/)
  })
})
