import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { assembleRoadmapContext, roadmapStructure } from './context'

const SOURCE = { app: 'Chrome', bundleId: null, url: null, title: 'Notes' }

describe('roadmap structure from the notes', () => {
  const seed = () => {
    const repos = createMemoryRepos(new FakeClock())
    const subject = repos.subjects.create({ name: 'Chemistry' })
    const topic = repos.concepts.upsert({ subjectId: subject.id, name: 'Substitution' })
    const sn1 = repos.concepts.upsert({
      subjectId: subject.id,
      name: 'SN1',
      parentName: 'Substitution',
    })
    const carbo = repos.concepts.upsert({
      subjectId: subject.id,
      name: 'Carbocations',
      parentName: 'Substitution',
    })
    const atoms = repos.concepts.upsert({ subjectId: subject.id, name: 'Atoms' })
    repos.concepts.update(atoms.id, { status: 'mastered', mastery: 0.95 })
    repos.edges.add({ fromId: carbo.id, toId: sn1.id })
    repos.edges.add({ fromId: atoms.id, toId: carbo.id })
    const note = (conceptId: string, text: string, kind: 'fact' | 'highlight' = 'fact') =>
      repos.notes.add({
        subjectId: subject.id,
        conceptId,
        encounterId: null,
        kind,
        text,
        source: SOURCE,
      }).note
    note(sn1.id, 'SN1 has two steps')
    note(carbo.id, 'Alkyl groups donate electron density')
    note(carbo.id, 'Hyperconjugation spreads the charge')
    note(carbo.id, 'Rearrangements move to a more stable cation')
    note(carbo.id, 'Tertiary carbocations are the most stable', 'highlight')
    return { repos, subject, topic, sn1, carbo, atoms }
  }

  it('orders prerequisites first, skips mastered and container topics, keeps 3 key notes', () => {
    const { repos, subject, topic, sn1, carbo, atoms } = seed()
    const s = roadmapStructure(repos, subject.id, repos.concepts.listBySubject(subject.id))
    expect(s.suggestedOrder).toEqual(['Carbocations', 'SN1'])
    expect(s.tree?.map((c) => [c.name, c.parentId])).toEqual([
      ['Substitution', null],
      ['SN1', topic.id],
      ['Carbocations', topic.id],
      ['Atoms', null],
    ])
    expect(s.edges).toEqual([
      { fromId: carbo.id, toId: sn1.id },
      { fromId: atoms.id, toId: carbo.id },
    ])
    const carboNotes = s.keyNotes?.filter((n) => n.conceptId === carbo.id).map((n) => n.text)
    expect(carboNotes).toHaveLength(3)
    expect(carboNotes?.[0]).toBe('Tertiary carbocations are the most stable')
  })

  it('follows the study preferences: skipped topics leave the order, focus leads it', () => {
    const { repos, subject, topic, sn1 } = seed()
    const kinetics = repos.concepts.upsert({ subjectId: subject.id, name: 'Kinetics' })
    repos.notes.add({
      subjectId: subject.id,
      conceptId: kinetics.id,
      encounterId: null,
      kind: 'fact',
      text: 'Rate = k[A]',
      source: SOURCE,
    })
    const concepts = () => repos.concepts.listBySubject(subject.id)
    expect(roadmapStructure(repos, subject.id, concepts()).suggestedOrder).toEqual([
      'Carbocations',
      'SN1',
      'Kinetics',
    ])
    repos.subjects.setStudyPreferences(subject.id, {
      instruction: 'kinetics first, skip substitution',
      focus: [kinetics.id],
      skip: [topic.id],
      focusNames: ['Arrhenius'],
      skipNames: [],
      updatedAt: '2026-10-25T09:00:00.000Z',
    })
    const s = roadmapStructure(repos, subject.id, concepts())
    expect(s.suggestedOrder).toEqual(['Kinetics'])
    expect(s.preferences).toEqual({
      instruction: 'kinetics first, skip substitution',
      focus: ['Kinetics', 'Arrhenius'],
      skip: ['Substitution'],
    })
    repos.subjects.setStudyPreferences(subject.id, {
      instruction: 'SN1 first',
      focus: [sn1.id],
      skip: [],
      focusNames: [],
      skipNames: [],
      updatedAt: '2026-10-25T09:00:00.000Z',
    })
    expect(roadmapStructure(repos, subject.id, concepts()).suggestedOrder).toEqual([
      'Carbocations',
      'SN1',
      'Kinetics',
    ])
    const bare = repos.subjects.create({ name: 'Biology' })
    repos.subjects.setStudyPreferences(bare.id, {
      instruction: 'cells only',
      focus: [],
      skip: [],
      focusNames: ['Cells'],
      skipNames: [],
      updatedAt: '2026-10-25T09:00:00.000Z',
    })
    expect(roadmapStructure(repos, bare.id, [])).toEqual({
      preferences: { instruction: 'cells only', focus: ['Cells'], skip: [] },
    })
  })

  it('travels in the roadmap context, and stays empty for a subject without concepts', () => {
    const { repos, subject } = seed()
    const ctx = assembleRoadmapContext(repos, {
      subject,
      goal: 'SN1',
      assistant: 'ChatGPT',
      question: null,
      nowIso: '2026-10-25T10:00:00.000Z',
    })
    expect(ctx.input.suggestedOrder).toEqual(['Carbocations', 'SN1'])
    const bare = repos.subjects.create({ name: 'Biology' })
    expect(roadmapStructure(repos, bare.id, [])).toEqual({})
  })
})
