import type { Id } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsolidateOutput } from '../../brain-contract'
import { FakeClock } from '../../clock'
import type { NewNoteInput } from '../../contracts'
import { createSqliteRepos, type SqliteRepos } from '../../store/sqlite-repos'
import { applyConsolidation, MAX_TOPICS } from './apply'

const SOURCE = { app: 'Chrome', bundleId: null, url: null, title: 'Notes' }
const empty = (over: Partial<ConsolidateOutput> = {}): ConsolidateOutput => ({
  summaries: [],
  mergeConcepts: [],
  mergeNotes: [],
  topics: [],
  placeNotes: [],
  edges: [],
  openQuestions: [],
  ...over,
})

describe('applyConsolidation', () => {
  let repos: SqliteRepos
  let subject: Id
  const concept = (name: string, parentName: string | null = null) =>
    repos.concepts.upsert({ subjectId: subject, name, parentName }).id
  const note = (conceptId: string | null, text: string, over: Partial<NewNoteInput> = {}) =>
    repos.notes.add({
      subjectId: subject,
      conceptId,
      encounterId: null,
      kind: 'fact',
      text,
      source: SOURCE,
      ...over,
    }).note.id

  beforeEach(() => {
    repos = createSqliteRepos(':memory:', new FakeClock())
    subject = repos.subjects.create({ name: 'Chemistry' }).id
  })

  it('writes summaries only from notes, never over a pinned summary or an unknown id', () => {
    const sn1 = concept('SN1')
    const sn2 = concept('SN2')
    const mine = concept('E1')
    note(sn1, 'Tertiary substrates favour SN1')
    note(mine, 'E1 competes with SN1')
    repos.concepts.update(mine, { summary: 'My own words', summaryPinned: true })
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        summaries: [
          { conceptId: sn1, summary: '  SN1 goes through a carbocation;  tertiary is fastest. ' },
          { conceptId: sn2, summary: 'Invented without notes' },
          { conceptId: mine, summary: 'Rewritten' },
          { conceptId: 'c99', summary: 'Unknown' },
        ],
      }),
    )
    expect(repos.concepts.get(sn1)?.summary).toBe(
      'SN1 goes through a carbocation; tertiary is fastest.',
    )
    expect(repos.concepts.get(sn2)?.summary).toBe('')
    expect(repos.concepts.get(mine)?.summary).toBe('My own words')
    expect(report.summaries).toBe(1)
    expect(report.skipped).toEqual([
      `summary ${sn2}: no notes`,
      `summary ${mine}: pinned`,
      'summary c99: unknown',
    ])
  })

  it('merges duplicate notes and concepts, never a pinned note', () => {
    const sn1 = concept('SN1')
    const unimol = concept('Unimolecular substitution')
    const a = note(sn1, 'SN1 has two steps')
    const b = note(sn1, 'The SN1 mechanism happens in two separate steps')
    const pinned = note(sn1, 'Rate = k[R-X]')
    const other = note(sn1, 'rate law is first order')
    repos.notes.update(pinned, { pinned: true })
    const c = note(unimol, 'Carbocation forms first')
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        mergeNotes: [
          { fromId: b, intoId: a, text: 'SN1 happens in two steps' },
          { fromId: other, intoId: pinned, text: null },
        ],
        mergeConcepts: [{ fromId: unimol, intoId: sn1 }],
      }),
      { relink: repos.relink },
    )
    expect(repos.notes.get(b)).toMatchObject({ status: 'merged', mergedInto: a })
    expect(repos.notes.get(a)?.text).toBe('SN1 happens in two steps')
    expect(repos.notes.get(other)?.status).toBe('active')
    expect(repos.concepts.get(unimol)).toBeNull()
    expect(repos.notes.get(c)?.conceptId).toBe(sn1)
    expect(report).toMatchObject({ mergedNotes: 1, mergedConcepts: 1 })
    expect(report.skipped).toContain(`mergeNotes ${other}: pinned`)
    // Without concept folding, merges are skipped.
    const x = concept('X')
    const y = concept('Y')
    expect(
      applyConsolidation(repos, subject, empty({ mergeConcepts: [{ fromId: x, intoId: y }] }))
        .skipped,
    ).toEqual([`mergeConcepts ${x}: no relink`])
  })

  it('places notes, but never moves a pinned one or into another subject', () => {
    const sn1 = concept('SN1')
    const loose = note(null, 'Tertiary carbocations are the most stable')
    const pinned = note(null, 'My note', { kind: 'highlight' })
    repos.notes.update(pinned, { pinned: true })
    const bio = repos.subjects.create({ name: 'Biology' })
    const cell = repos.concepts.upsert({ subjectId: bio.id, name: 'Cells' }).id
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        placeNotes: [
          { noteId: loose, conceptId: sn1 },
          { noteId: pinned, conceptId: sn1 },
          { noteId: loose, conceptId: cell },
        ],
      }),
    )
    expect(repos.notes.get(loose)?.conceptId).toBe(sn1)
    expect(repos.notes.get(pinned)?.conceptId).toBeNull()
    expect(report.placedNotes).toBe(1)
  })

  it('moves a concept with its notes to another active subject, never elsewhere', () => {
    const enzymes = concept('Enzymes')
    const sn1 = concept('SN1')
    const a = note(enzymes, 'Enzymes lower the activation energy')
    const b = note(enzymes, 'Active sites bind substrates', { kind: 'highlight' })
    repos.notes.update(b, { pinned: true })
    const stay = note(sn1, 'SN1 has two steps')
    const bio = repos.subjects.create({ name: 'Biology' }).id
    const old = repos.subjects.create({ name: 'Old', status: 'archived' }).id
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        moveConcepts: [
          { conceptId: sn1, subjectId: 'sub_missing' },
          { conceptId: sn1, subjectId: old },
          { conceptId: sn1, subjectId: subject },
          { conceptId: 'c42', subjectId: bio },
          { conceptId: enzymes, subjectId: bio },
        ],
      }),
      { relink: repos.relink },
    )
    expect(repos.concepts.get(enzymes)?.subjectId).toBe(bio)
    expect(repos.notes.get(a)?.subjectId).toBe(bio)
    expect(repos.notes.get(b)).toMatchObject({ subjectId: bio, conceptId: enzymes, pinned: true })
    expect(repos.concepts.get(sn1)?.subjectId).toBe(subject)
    expect(repos.notes.get(stay)?.subjectId).toBe(subject)
    expect(report.movedConcepts).toBe(1)
    expect(report.movedTo).toEqual([bio])
    expect(report.skipped).toEqual([
      `moveConcepts ${sn1}: unknown`,
      `moveConcepts ${sn1}: unknown`,
      `moveConcepts ${sn1}: unknown`,
      'moveConcepts c42: unknown',
    ])
    // Without relink, moves are skipped.
    const r2 = applyConsolidation(
      repos,
      subject,
      empty({ moveConcepts: [{ conceptId: sn1, subjectId: bio }] }),
    )
    expect(r2.skipped).toEqual([`moveConcepts ${sn1}: no relink`])
    expect(r2).toMatchObject({ movedConcepts: 0, movedTo: [] })
    expect(repos.concepts.get(sn1)?.subjectId).toBe(subject)
  })

  it('builds topics with evidence, refuses loops and empty topics', () => {
    const sn1 = concept('SN1')
    const sn2 = concept('SN2')
    const lonely = concept('Alkenes')
    note(sn1, 'SN1: two steps')
    note(sn2, 'SN2: one step')
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        topics: [
          { conceptId: null, name: 'Substitution', children: [sn1, sn2] },
          { conceptId: null, name: 'Empty topic', children: [lonely] },
          // SN1 would sit under its own child: refused for that child only.
          { conceptId: sn1, name: 'SN1', children: ['c404'] },
        ],
      }),
    )
    const substitution = repos.concepts.findByName(subject, 'Substitution')
    expect(substitution?.parentId).toBeNull()
    expect(repos.concepts.get(sn2)?.parentId).toBe(substitution?.id)
    expect(repos.concepts.findByName(subject, 'Empty topic')).toBeNull()
    expect(report.skipped).toContain('topic Empty topic: no notes')
    expect(report.newTopics).toBe(1)

    // SN1 becomes a topic over its old parent: SN1 moves to the top first, so no loop forms.
    applyConsolidation(
      repos,
      subject,
      empty({ topics: [{ conceptId: sn1, name: 'SN1', children: [substitution?.id as string] }] }),
    )
    const all = repos.concepts.listBySubject(subject)
    const byId = new Map(all.map((c) => [c.id, c]))
    for (const c of all) {
      let steps = 0
      for (let x = c.parentId; x; x = byId.get(x)?.parentId ?? null) steps++
      expect(steps).toBeLessThan(all.length)
    }
    expect(repos.concepts.get(sn1)?.parentId).toBeNull()
    expect(repos.concepts.get(substitution?.id as string)?.parentId).toBe(sn1)
  })

  it('keeps at most MAX_TOPICS topics', () => {
    const topics = Array.from({ length: MAX_TOPICS + 2 }, (_, i) => {
      const c = concept(`Concept ${i}`)
      note(c, `Fact ${i}`)
      return { conceptId: null, name: `Topic ${i}`, children: [c] }
    })
    const report = applyConsolidation(repos, subject, empty({ topics }))
    const roots = repos.concepts.listBySubject(subject).filter((c) => c.parentId === null)
    expect(roots.length).toBe(MAX_TOPICS)
    expect(roots.map((r) => r.name)).toContain('Other topics')
    expect(report.skipped.filter((x) => x.includes(`over ${MAX_TOPICS}`))).toHaveLength(2)
  })

  it('adds edges without cycles and turns open questions into question notes', () => {
    const a = concept('Atoms')
    const b = concept('Bonds')
    const report = applyConsolidation(
      repos,
      subject,
      empty({
        edges: [
          { fromId: a, toId: b, why: 'bonds join atoms' },
          { fromId: b, toId: a, why: 'loop' },
          { fromId: a, toId: 'c7', why: 'unknown' },
        ],
        openQuestions: [
          { conceptId: b, question: 'Why do bonds form?' },
          { conceptId: null, question: 'What is on the exam?' },
        ],
      }),
    )
    expect(repos.edges.list(subject).map((e) => [e.fromId, e.toId, e.why])).toEqual([
      [a, b, 'bonds join atoms'],
    ])
    expect(report.edges).toBe(1)
    expect(report.skipped).toEqual([`edge ${b}→${a}: refused`, `edge ${a}→c7: unknown`])
    const questions = repos.notes.list({ subjectId: subject }).filter((n) => n.kind === 'question')
    expect(questions.map((q) => [q.text, q.conceptId])).toEqual([
      ['Why do bonds form?', b],
      ['What is on the exam?', null],
    ])
  })
})
