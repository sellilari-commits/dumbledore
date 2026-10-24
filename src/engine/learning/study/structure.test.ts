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

  it('names the pages each tree entry was read in, its subtree included, at most 4', () => {
    const { repos, subject, sn1, carbo } = seed()
    const read = (conceptId: string, text: string, n: number) =>
      repos.notes.add({
        subjectId: subject.id,
        conceptId,
        encounterId: null,
        kind: 'fact',
        text,
        source: {
          app: 'Google Chrome',
          bundleId: null,
          url: `https://site${n}.example/page`,
          title: `Page ${n} - Google Chrome`,
        },
      })
    read(sn1.id, 'The rate depends on the substrate only', 1)
    read(sn1.id, 'Polar protic solvents speed up ionisation', 2)
    read(sn1.id, 'Racemisation follows from a planar intermediate', 3)
    read(carbo.id, 'Allylic cations are resonance stabilised', 4)
    const s = roadmapStructure(repos, subject.id, repos.concepts.listBySubject(subject.id))
    const sources = (name: string) => s.tree?.find((c) => c.name === name)?.sources
    expect([...(sources('Carbocations') ?? [])].sort()).toEqual(['Notes', 'Page 4'])
    expect([...(sources('SN1') ?? [])].sort()).toEqual(['Notes', 'Page 1', 'Page 2', 'Page 3'])
    // The topic lists its children's pages (5 in all), capped at 4.
    expect(sources('Substitution')).toHaveLength(4)
    expect(
      sources('Substitution')?.every((t) =>
        ['Notes', 'Page 1', 'Page 2', 'Page 3', 'Page 4'].includes(t),
      ),
    ).toBe(true)
    // No notes, no sources key.
    expect(s.tree?.find((c) => c.name === 'Atoms')).not.toHaveProperty('sources')
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
