/** SQLite-only behaviour: persistence, pragmas, migrations, rollback, integrity and relinking. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { encounterInput, episode, quiz, roadmap } from './conformance/fixtures'
import { openDatabase } from './db'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from './migrations'
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

  it('reads episodes stored before highlights existed with no highlights', () => {
    const repos = make()
    const ep = episode()
    repos.episodes.save(ep)
    const { highlights: _h, ...old } = ep.signals
    repos.db.prepare('UPDATE episodes SET signals = ? WHERE id = ?').run(JSON.stringify(old), ep.id)
    expect(repos.episodes.get(ep.id)?.signals.highlights).toEqual([])
    expect(repos.episodes.listUnextracted(5)[0]?.signals.highlights).toEqual([])
  })

  it('records migrations once and refuses databases from a newer version', () => {
    const path = tempDb()
    make(path).close()
    const db = openDatabase(path)
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(db.prepare('SELECT COUNT(*) FROM schema_version').pluck().get()).toBe(MIGRATIONS.length)
    expect(migrate(db, '2026-10-24T09:00:00.000Z')).toEqual([])
    db.prepare('INSERT INTO schema_version VALUES (?, ?, ?)').run(999, 'future', 'x')
    db.close()
    expect(() => openDatabase(path)).toThrow(/newer/)
  })

  it('upgrades a v1 database: rows kept, search rows renumbered, notes usable', () => {
    const path = tempDb()
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    migrate(raw, '2026-10-01T00:00:00.000Z', MIGRATIONS.slice(0, 1))
    const at = '2026-10-01T00:00:00.000Z'
    raw
      .prepare(
        `INSERT INTO subjects (id, name, name_key, emoji, color, description, goal, deadline, status, focus, created_at, updated_at)
         VALUES ('sub_old', 'History', 'history', '📘', 'default', 'Old towns', NULL, NULL, 'active', 'normal', ?, ?)`,
      )
      .run(at, at)
    raw
      .prepare(
        `INSERT INTO concepts (id, subject_id, parent_id, name, name_key, summary, mastery, box, next_review_at, status, struggle_count, last_seen_at)
         VALUES ('con_old', 'sub_old', NULL, 'Tampere', 'tampere', 'Founded 1779', 0, 0, NULL, 'new', 0, NULL)`,
      )
      .run()
    // v1 search rows: rowid = seq * 4 + kind (subject 0, concept 1).
    raw
      .prepare('INSERT INTO search_fts (rowid, f1, f2, f3) VALUES (4, ?, ?, NULL)')
      .run('history', 'old towns')
    raw
      .prepare('INSERT INTO search_fts (rowid, f1, f2, f3) VALUES (5, ?, ?, NULL)')
      .run('tampere', 'founded 1779')
    raw.close()

    const repos = make(path)
    expect(currentSchemaVersion(repos.db)).toBe(LATEST_SCHEMA_VERSION)
    expect(repos.subjects.get('sub_old')?.name).toBe('History')
    expect(repos.search.query('tampere', 5).map((h) => [h.kind, h.id])).toEqual([
      ['concept', 'con_old'],
    ])
    expect(repos.search.query('old towns', 5).map((h) => h.id)).toEqual(['sub_old'])
    const note = repos.notes.add({
      subjectId: 'sub_old',
      conceptId: 'con_old',
      encounterId: null,
      kind: 'fact',
      text: 'Finlayson founded a cotton mill in 1820',
      source: { app: 'Chrome', bundleId: null, url: null, title: 'Tampere' },
    }).note
    expect(repos.notes.list({ conceptId: 'con_old' }).map((n) => n.id)).toEqual([note.id])
    expect(repos.search.query('cotton mill', 5).map((h) => [h.kind, h.id])).toEqual([
      ['concept', 'con_old'],
    ])
    const cols = repos.db.prepare("SELECT name FROM pragma_table_info('concepts')").pluck().all()
    expect(cols).toContain('summary_pinned')
  })

  it('upgrades a v2 database to v3: subject kept, study preferences start empty and persist', () => {
    const path = tempDb()
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    migrate(raw, '2026-10-01T00:00:00.000Z', MIGRATIONS.slice(0, 2))
    const at = '2026-10-01T00:00:00.000Z'
    raw
      .prepare(
        `INSERT INTO subjects (id, name, name_key, emoji, color, description, goal, deadline, status, focus, created_at, updated_at)
         VALUES ('sub_v2', 'Chemistry', 'chemistry', '📘', 'default', '', NULL, NULL, 'active', 'normal', ?, ?)`,
      )
      .run(at, at)
    raw.close()

    const repos = make(path)
    expect(currentSchemaVersion(repos.db)).toBe(LATEST_SCHEMA_VERSION)
    expect(repos.subjects.get('sub_v2')?.name).toBe('Chemistry')
    expect(repos.subjects.studyPreferences('sub_v2')).toBeNull()
    const prefs = {
      instruction: 'SN1, not SN2',
      focus: ['con_a'],
      skip: [],
      focusNames: [],
      skipNames: ['Kinetics'],
      updatedAt: at,
    }
    repos.subjects.setStudyPreferences('sub_v2', prefs)
    repos.db.close()
    expect(make(path).subjects.studyPreferences('sub_v2')).toEqual(prefs)
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
    repos.encounters.add(encounterInput({ subjectId: s.id, openQuestions: ['Why?'] }))
    expect(repos.encounters.openQuestions(s.id, 0)).toEqual([])
    repos.chat.append({ thread: 't', role: 'user', content: 'hi', actions: [] })
    expect(repos.chat.history('t', 0)).toEqual([])
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
