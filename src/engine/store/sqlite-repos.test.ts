/** SQLite-only behaviour: persistence, pragmas, migrations, rollback, integrity and relinking. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { encounterInput, quiz, roadmap } from './conformance/fixtures'
import { openDatabase } from './db'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, migrate } from './migrations'
import { createSqliteRepos, type SqliteRepos } from './sqlite-repos'

const open: SqliteRepos[] = []
const dirs: string[] = []
afterEach(() => {
  for (const r of open.splice(0)) r.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dumbledore-db-'))
  dirs.push(dir)
  return join(dir, 'nested', 'dumbledore.db')
}

function make(path = ':memory:', clock = new FakeClock()): SqliteRepos {
  const repos = createSqliteRepos(path, clock)
  open.push(repos)
  return repos
}

describe('createSqliteRepos', () => {
  it('persists across reopen, in WAL mode with foreign keys on', () => {
    const path = tempDb()
    const first = make(path)
    const s = first.subjects.create({ name: 'Organic Chemistry', emoji: '🧪' })
    first.concepts.upsert({ subjectId: s.id, name: 'SN1', parentName: 'Substitution' })
    first.settings.update({ captureEnabled: false })
    first.close()

    const second = make(path)
    expect(second.subjects.findByName('organic chemistry')?.emoji).toBe('🧪')
    expect(second.concepts.listBySubject(s.id).map((c) => c.name)).toEqual(['Substitution', 'SN1'])
    expect(second.settings.get().captureEnabled).toBe(false)
    expect(second.search.query('subst', 5).map((h) => h.title)).toEqual(['Substitution'])
    expect(second.db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(second.db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('records migrations once and refuses databases from a newer version', () => {
    const path = tempDb()
    make(path).close()
    const db = openDatabase(path)
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(db.prepare('SELECT COUNT(*) FROM schema_version').pluck().get()).toBe(1)
    expect(migrate(db, '2026-10-24T09:00:00.000Z')).toEqual([])
    db.prepare('INSERT INTO schema_version VALUES (?, ?, ?)').run(999, 'future', 'x')
    db.close()
    expect(() => openDatabase(path)).toThrow(/newer/)
  })

  it('rolls back a transaction that throws', () => {
    const repos = make()
    expect(() =>
      repos.transaction(() => {
        repos.subjects.create({ name: 'Chem' })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(repos.subjects.list()).toEqual([])
    expect(repos.search.query('chem', 5)).toEqual([])
  })

  it('rejects dangling subject references', () => {
    const repos = make()
    expect(() => repos.concepts.upsert({ subjectId: 'sub_missing', name: 'X' })).toThrow(
      /FOREIGN KEY/,
    )
    expect(() => repos.roadmaps.save(roadmap('sub_missing'))).toThrow(/FOREIGN KEY/)
  })

  it('bumps the roadmap version on every save', () => {
    const repos = make()
    const s = repos.subjects.create({ name: 'Chem' })
    repos.roadmaps.save(roadmap(s.id))
    repos.roadmaps.save(roadmap(s.id, { status: 'paused' }))
    expect(repos.db.prepare('SELECT version FROM roadmaps').pluck().get()).toBe(2)
  })

  it('handles inputs the in-memory twin gets wrong', () => {
    const repos = make()
    const s = repos.subjects.create({ name: 'Chem' })
    const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1', parentName: 'sn1' })
    expect(c.parentId).toBeNull()
    expect(repos.concepts.listBySubject(s.id)).toHaveLength(1)
    repos.encounters.add(encounterInput({ subjectId: s.id, openQuestions: ['Why?'] }))
    expect(repos.encounters.openQuestions(s.id, 0)).toEqual([])
    repos.chat.append({ thread: 't', role: 'user', content: 'hi', actions: [] })
    expect(repos.chat.history('t', 0)).toEqual([])
    expect(() => repos.subjects.merge(s.id, s.id)).toThrow(/itself/)
    expect(repos.subjects.get(s.id)).not.toBeNull()
  })

  it('remaps quiz questions of merged-away concepts', () => {
    const repos = make()
    const from = repos.subjects.create({ name: 'Orgo' })
    const into = repos.subjects.create({ name: 'Organic Chemistry' })
    const twin = repos.concepts.upsert({ subjectId: into.id, name: 'SN1' })
    const dup = repos.concepts.upsert({ subjectId: from.id, name: 'SN1' })
    const q = quiz()
    repos.quizzes.save({ ...q, questions: q.questions.map((x) => ({ ...x, conceptId: dup.id })) })
    repos.subjects.merge(from.id, into.id)
    expect(repos.quizzes.get(q.id)?.questions.map((x) => x.conceptId)).toEqual([twin.id, twin.id])
  })

  it('relinks: moves a concept between subjects and re-points encounters', () => {
    const repos = make()
    const a = repos.subjects.create({ name: 'A' })
    const b = repos.subjects.create({ name: 'B' })
    const parent = repos.concepts.upsert({ subjectId: a.id, name: 'Parent' })
    const moving = repos.concepts.upsert({ subjectId: a.id, name: 'Moving', parentName: 'Parent' })
    const child = repos.concepts.upsert({ subjectId: a.id, name: 'Child', parentName: 'Moving' })
    const bParent = repos.concepts.upsert({ subjectId: b.id, name: 'parent' })
    const e = repos.encounters.add(encounterInput({ subjectId: a.id, conceptId: child.id }))

    repos.relink.moveConcept(moving.id, b.id)
    expect(repos.concepts.get(moving.id)).toMatchObject({ subjectId: b.id, parentId: bParent.id })
    expect(repos.concepts.get(child.id)).toMatchObject({ subjectId: a.id, parentId: parent.id })
    expect(repos.search.query('moving', 5)[0]?.route).toBe(`/subjects/${b.id}/concepts`)

    repos.relink.setEncounterConcept(e.id, moving.id)
    expect(repos.encounters.list({})[0]?.conceptId).toBe(moving.id)
    expect(() => repos.relink.moveConcept('con_missing', b.id)).toThrow(/not found/)
  })
})
