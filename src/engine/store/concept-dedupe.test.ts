/** SQLite-only concept dedupe: stored keys stay compatible, read-only opens, folding in place. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { normalizeName } from './codec'
import { encounterInput } from './conformance/fixtures'
import { createSqliteRepos, type SqliteRepos } from './sqlite-repos'

const open: SqliteRepos[] = []
const dirs: string[] = []
afterEach(() => {
  for (const r of open.splice(0)) r.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dumbledore-dedupe-'))
  dirs.push(dir)
  return join(dir, 'dumbledore.db')
}

function make(path = ':memory:', readonly = false): SqliteRepos {
  const repos = createSqliteRepos(path, new FakeClock(), { readonly })
  open.push(repos)
  return repos
}

describe('concept keys in SQLite', () => {
  it('keeps name_key in the format older builds look up, and matches by conceptKey', () => {
    const repos = make()
    const s = repos.subjects.create({ name: 'Chemistry' })
    const lg = repos.concepts.upsert({ subjectId: s.id, name: 'Leaving groups' })
    const key = () => repos.db.prepare('SELECT name_key FROM concepts WHERE id = ?').pluck()
    expect(key().get(lg.id)).toBe('leaving groups')
    expect(repos.concepts.findByName(s.id, 'leaving-Group')?.id).toBe(lg.id)
    const nu = repos.concepts.upsert({ subjectId: s.id, name: 'nucleophiles' })
    repos.concepts.upsert({ subjectId: s.id, name: 'Nucleophile' })
    expect(key().get(nu.id)).toBe(normalizeName('Nucleophile'))
  })

  it('opens read-only without writing anything', () => {
    const path = tempDb()
    const writer = make(path)
    const s = writer.subjects.create({ name: 'Chemistry' })
    writer.concepts.upsert({ subjectId: s.id, name: 'Leaving groups' })
    writer.db.prepare('DELETE FROM profile').run()
    writer.close()
    const before = readFileSync(path)

    const reader = make(path, true)
    expect(reader.db.readonly).toBe(true)
    expect(reader.concepts.findByName(s.id, 'leaving group')?.name).toBe('Leaving groups')
    expect(reader.profile.get().aboutMe).toBe('')
    expect(reader.db.prepare('SELECT COUNT(*) FROM profile').pluck().get()).toBe(0)
    reader.close()
    expect(readFileSync(path).equals(before)).toBe(true)
  })
})

describe('relink.mergeConcepts', () => {
  it('folds a duplicate into the older concept of the same subject', () => {
    const repos = make()
    const s = repos.subjects.create({ name: 'Chemistry' })
    const older = repos.concepts.upsert({ subjectId: s.id, name: 'leaving groups' })
    const parent = repos.concepts.upsert({ subjectId: s.id, name: 'Substitution' })
    // A duplicate made outside upsert (renamed later, or written by an older version).
    const dup = repos.concepts.update(
      repos.concepts.upsert({ subjectId: s.id, name: 'Leaving ions' }).id,
      { name: 'Leaving Group', parentId: parent.id, mastery: 0.4, struggleCount: 2 },
    )
    const child = repos.concepts.upsert({ subjectId: s.id, name: 'Halides', parentName: 'X' })
    repos.concepts.update(child.id, { parentId: dup.id })
    const enc = repos.encounters.add(encounterInput({ subjectId: s.id, conceptId: dup.id }))

    repos.relink.mergeConcepts(dup.id, older.id)

    expect(repos.concepts.get(dup.id)).toBeNull()
    expect(repos.concepts.get(older.id)).toMatchObject({
      name: 'Leaving Group', // the capitalized name is clearly nicer
      parentId: null,
      mastery: 0.4,
      struggleCount: 2,
    })
    expect(repos.concepts.get(child.id)?.parentId).toBe(older.id)
    expect(repos.encounters.list({})).toMatchObject([{ id: enc.id, conceptId: older.id }])
    expect(repos.search.query('leaving', 5).map((h) => [h.kind, h.id])).toEqual([
      ['concept', older.id],
    ])
    expect(repos.concepts.findByName(s.id, 'leaving group')?.id).toBe(older.id)
  })

  it('refuses concepts of different subjects', () => {
    const repos = make()
    const a = repos.subjects.create({ name: 'A' })
    const b = repos.subjects.create({ name: 'B' })
    const x = repos.concepts.upsert({ subjectId: a.id, name: 'X' })
    const y = repos.concepts.upsert({ subjectId: b.id, name: 'X' })
    expect(() => repos.relink.mergeConcepts(x.id, y.id)).toThrow(/different subjects/)
    expect(() => repos.relink.mergeConcepts(x.id, 'con_missing')).toThrow(/not found/)
    repos.relink.mergeConcepts(x.id, x.id)
    expect(repos.concepts.get(x.id)).toEqual(x)
  })
})
