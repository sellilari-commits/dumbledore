import type { Concept, Id, UnderstandingStatus } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ExtractedItem, ExtractOutput } from '../../brain-contract'
import { FakeClock } from '../../clock'
import type { MasteryModel, Repos } from '../../contracts'
import { createMemoryRepos } from '../../testing/memory-repos'
import { makeEpisode } from '../testing/episodes'
import { applyExtraction, normalizeDue, PromptMemory, sameSubjectName } from './apply'

const item = (overrides: Partial<ExtractedItem> = {}): ExtractedItem => ({
  subject: { matchId: null, newName: 'Organic Chemistry' },
  topicPath: ['Organic Chemistry', 'Nucleophilic substitution', 'SN1'],
  seen: 'Rate = k[R–X]; tertiary substrates favour SN1.',
  bigPicture: 'Working out when SN1 happens, for the midterm.',
  understanding: { status: 'struggling', evidence: 'Scrolled back 3 times' },
  openQuestions: ['Why are tertiary carbocations more stable?'],
  keyTerms: ['SN1', 'carbocation'],
  assignment: null,
  ...overrides,
})

const output = (episodeId: string, items: ExtractedItem[], extra: Partial<ExtractOutput['results'][number]> = {}): ExtractOutput => ({
  results: [{ episodeId, isLearning: items.length > 0, confidence: 0.9, reason: 'study', items, studentPrompts: [], ...extra }],
})

describe('applyExtraction', () => {
  let repos: Repos
  let prompts: PromptMemory
  const nowIso = '2026-10-24T10:00:00.000Z'

  beforeEach(() => {
    repos = createMemoryRepos(new FakeClock())
    prompts = new PromptMemory()
  })

  it('suggests a new subject and builds the concept chain under it', () => {
    const ep = makeEpisode()
    repos.episodes.save(ep)
    const out = applyExtraction(output(ep.id, [item()]), [ep], repos, { prompts, nowIso })
    const subject = repos.subjects.findByName('organic chemistry')
    expect(subject?.status).toBe('suggested')
    expect(out.newSubjectIds).toEqual([subject?.id])
    const concepts = repos.concepts.listBySubject(subject?.id as Id)
    expect(concepts.map((c) => c.name).sort()).toEqual(['Nucleophilic substitution', 'SN1'])
    const leaf = concepts.find((c) => c.name === 'SN1') as Concept
    const parent = concepts.find((c) => c.name === 'Nucleophilic substitution') as Concept
    expect(leaf.parentId).toBe(parent.id)
    expect(leaf.summary).toContain('Rate = k')
    expect(leaf.lastSeenAt).toBe(ep.endedAt)
    const [enc] = repos.encounters.list({})
    expect(enc).toMatchObject({
      subjectId: subject?.id,
      conceptId: leaf.id,
      episodeId: ep.id,
      understanding: 'struggling',
      evidence: 'Scrolled back 3 times',
      inboxState: 'new',
      dwellSeconds: 180,
      source: { app: 'Google Chrome', url: ep.url, title: ep.title, bundleId: ep.bundleId },
    })
    expect(out.episodeSubjects).toEqual([{ episodeId: ep.id, subjectId: subject?.id }])
  })

  it('matches existing subjects by id or by a near-identical name, never duplicating', () => {
    const chem = repos.subjects.create({ name: 'Organic Chemistry' })
    const ep = makeEpisode()
    applyExtraction(
      output(ep.id, [
        item({ subject: { matchId: chem.id, newName: null } }),
        item({ subject: { matchId: null, newName: 'organic chemistry I' } }),
        item({ subject: { matchId: 'sub_hallucinated', newName: 'Organic  Chemistry' } }),
      ]),
      [ep],
      repos,
      { prompts, nowIso },
    )
    expect(repos.subjects.list()).toHaveLength(1)
    expect(repos.encounters.list({ subjectId: chem.id })).toHaveLength(3)
    expect(repos.concepts.listBySubject(chem.id)).toHaveLength(2)
    expect(sameSubjectName('Linear Algebra II', 'linear algebra')).toBe(true)
    expect(sameSubjectName('Chemistry', 'Organic Chemistry')).toBe(false)
  })

  it('upserts assignments with normalised due dates', () => {
    const ep = makeEpisode({ url: 'https://mycourses.aalto.fi/mod/assign/view.php?id=7' })
    const assignment = { title: 'Assignment 3: Linear regression', course: 'Statistics', dueAt: '2026-10-31' }
    applyExtraction(output(ep.id, [item({ assignment })]), [ep], repos, { prompts, nowIso })
    applyExtraction(output(ep.id, [item({ assignment })]), [ep], repos, { prompts, nowIso })
    const list = repos.assignments.list({})
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: 'Assignment 3: Linear regression', course: 'Statistics', source: ep.url })
    expect(list[0]?.dueAt).toBe(new Date(2026, 9, 31, 23, 59).toISOString())
    expect(normalizeDue('2026-10-31T21:59:00Z')).toBe('2026-10-31T21:59:00.000Z')
    expect(normalizeDue('next friday')).toBeNull()
  })

  it('counts prompt habits once per prompt, also for non-learning chats', () => {
    const ep = makeEpisode({ kind: 'ai_chat' })
    const studentPrompts = [
      { text: 'Explain SN1 with an example', hasContext: false, hasStructure: false, asksToBeQuizzed: false, asksForExamples: true },
      { text: "I'm a 1st-year chem student. Quiz me on SN1 in 3 questions", hasContext: true, hasStructure: true, asksToBeQuizzed: true, asksForExamples: false },
    ]
    const out = applyExtraction(output(ep.id, [], { studentPrompts }), [ep], repos, { prompts, nowIso })
    applyExtraction(output(ep.id, [], { studentPrompts }), [ep], repos, { prompts, nowIso })
    expect(out.profileChanged).toBe(true)
    expect(out.encounterIds).toEqual([])
    expect(repos.profile.get().habits).toEqual({
      promptsSeen: 2,
      withContext: 1,
      withStructure: 1,
      askedToBeQuizzed: 1,
      askedForExamples: 1,
    })
  })

  it('lets the mastery model react to each encounter', () => {
    const calls: [Id, UnderstandingStatus][] = []
    const mastery: MasteryModel = {
      applyAnswer: () => {
        throw new Error('unused')
      },
      applyEncounter: (conceptId, understanding) => {
        calls.push([conceptId, understanding])
        return repos.concepts.get(conceptId) as Concept
      },
    }
    const ep = makeEpisode()
    applyExtraction(output(ep.id, [item()]), [ep], repos, { prompts, nowIso, mastery })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toBe('struggling')
  })

  it('ignores results for unknown episodes and items without a subject', () => {
    const ep = makeEpisode()
    const out = applyExtraction(output('epi_other', [item()]), [ep], repos, { prompts, nowIso })
    expect(out.encounterIds).toEqual([])
    const noSubject = applyExtraction(
      output(ep.id, [item({ subject: { matchId: null, newName: null }, topicPath: ['Something'] })]),
      [ep],
      repos,
      { prompts, nowIso },
    )
    expect(noSubject.encounterIds).toHaveLength(1)
    expect(repos.encounters.list({})[0]?.subjectId).toBeNull()
    expect(repos.subjects.list()).toHaveLength(0)
  })
})
