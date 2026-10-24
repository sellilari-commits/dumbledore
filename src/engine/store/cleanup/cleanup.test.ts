/** Memory cleanup: plan, apply, the CLI (dry run, backup, memory files) and the running-app guard. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { createMemoryMirror } from '../../subjects/memory-mirror'
import { encounterInput, quiz } from '../conformance/fixtures'
import { type DataPaths, resolveDataPaths } from '../paths'
import { createSqliteRepos, type SqliteRepos } from '../sqlite-repos'
import { applyCleanup } from './apply'
import { runCleanupCli } from './cli'
import { findRunningApp, type GuardProbes } from './guard'
import { formatPlan, planCleanup } from './plan'

const dirs: string[] = []
const open: SqliteRepos[] = []
afterEach(() => {
  for (const r of open.splice(0)) r.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const idle: GuardProbes = { processName: () => null, holders: () => [] }
const MERGE = { from: 'SN1 and SN2 reactions differ', into: 'Chemistry' }

function dataDir(): DataPaths {
  const root = mkdtempSync(join(tmpdir(), 'dumbledore-cleanup-'))
  dirs.push(root)
  return resolveDataPaths({ root })
}

/** The shape of the real data: a badly named test subject that duplicates Chemistry. */
function seed(paths: DataPaths) {
  const repos = createSqliteRepos(paths.dbFile, new FakeClock())
  const sn = repos.subjects.create({ name: 'SN1 and SN2 reactions differ' })
  const chem = repos.subjects.create({ name: 'Chemistry' })
  const c = (subjectId: string, name: string) => repos.concepts.upsert({ subjectId, name })
  const ids = {
    sn,
    chem,
    nucleophiles: c(sn.id, 'nucleophiles').id,
    leavingGroups: c(sn.id, 'leaving groups').id,
    sn2: c(sn.id, 'SN2 mechanism').id,
    backside: c(sn.id, 'backside attack').id,
    chemLeaving: c(chem.id, 'Leaving groups').id,
    nucleophile: c(chem.id, 'Nucleophile').id,
    chemSn2: c(chem.id, 'SN2 Mechanism').id,
    leavingGroup: '',
  }
  repos.concepts.update(ids.chemLeaving, { status: 'struggling', struggleCount: 1 })
  // "Leaving Group" slipped in before matching ignored plurals: a same-subject duplicate.
  ids.leavingGroup = c(chem.id, 'Leaving ion').id
  repos.concepts.update(ids.leavingGroup, { name: 'Leaving Group', mastery: 0.02 })
  repos.encounters.add(encounterInput({ subjectId: sn.id, conceptId: ids.sn2 }))
  const q = quiz({ subjectIds: [sn.id] })
  repos.quizzes.save({
    ...q,
    questions: q.questions.map((x) => ({ ...x, conceptId: ids.nucleophiles })),
  })
  const mirror = createMemoryMirror({ repos, clock: new FakeClock(), dir: paths.memoryDir })
  mirror.regenerateAll()
  mirror.flush()
  mirror.dispose()
  repos.close()
  return ids
}

function reopen(paths: DataPaths): SqliteRepos {
  const repos = createSqliteRepos(paths.dbFile, new FakeClock())
  open.push(repos)
  return repos
}

describe('planCleanup + applyCleanup', () => {
  it('plans the duplicate groups and the merge, then applies exactly that', () => {
    const paths = dataDir()
    const ids = seed(paths)
    const repos = reopen(paths)
    const plan = planCleanup(repos, MERGE)
    expect(
      plan.groups.map((g) => [g.subjectName, g.intoName, g.members.map((m) => m.name)]),
    ).toEqual([['Chemistry', 'Leaving groups', ['Leaving Group']]])
    expect(plan.merge?.folds.map((g) => [g.intoName, g.members.map((m) => m.name)])).toEqual([
      ['Nucleophile', ['nucleophiles']],
      ['Leaving groups', ['leaving groups']],
      ['SN2 Mechanism', ['SN2 mechanism']],
    ])
    expect(plan.merge?.moves.map((m) => m.name)).toEqual(['backside attack'])
    expect(plan.merge?.counts).toEqual({ encounters: 1, roadmaps: 0, quizzes: 1, assignments: 0 })
    expect(formatPlan(plan).join('\n')).toContain('fold "nucleophiles" → "Nucleophile"')

    applyCleanup(repos, plan, MERGE)

    expect(repos.subjects.list().map((s) => s.name)).toEqual(['Chemistry'])
    expect(repos.concepts.listBySubject(ids.chem.id).map((c) => c.name)).toEqual([
      'backside attack',
      'Leaving groups',
      'Nucleophile',
      'SN2 Mechanism',
    ])
    expect(repos.concepts.get(ids.chemLeaving)).toMatchObject({
      status: 'struggling',
      mastery: 0.02,
    })
    expect(repos.encounters.list({})[0]).toMatchObject({
      subjectId: ids.chem.id,
      conceptId: ids.chemSn2,
    })
    expect(repos.quizzes.get('quz_1')?.questions.map((x) => x.conceptId)).toEqual([
      ids.nucleophile,
      ids.nucleophile,
    ])
    expect(planCleanup(repos).groups).toEqual([])
  })

  it('refuses a plan that no longer matches the data and leaves everything as it was', () => {
    const paths = dataDir()
    seed(paths)
    const repos = reopen(paths)
    const plan = planCleanup(repos, MERGE)
    repos.concepts.upsert({ subjectId: plan.merge?.fromId ?? '', name: 'Carbocation' })
    expect(() => applyCleanup(repos, plan, MERGE)).toThrow(/changed/)
    expect(repos.subjects.list()).toHaveLength(2)
    expect(() => planCleanup(repos, { from: 'Nope', into: 'Chemistry' })).toThrow(
      /no subject called "Nope"/,
    )
    expect(() => planCleanup(repos, { from: 'chemistry', into: 'Chemistry' })).toThrow(
      /one subject/,
    )
  })
})

describe('runCleanupCli', () => {
  it('dry run prints the plan and changes nothing', async () => {
    const paths = dataDir()
    seed(paths)
    const before = readFileSync(paths.dbFile)
    const lines: string[] = []
    const code = await runCleanupCli(['--merge-subject', MERGE.from, MERGE.into], {
      paths,
      probes: idle,
      log: (l) => lines.push(l),
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toMatch(
      /"Leaving Group" → "Leaving groups"[\s\S]*move "backside attack"[\s\S]*Dry run/,
    )
    expect(readFileSync(paths.dbFile).equals(before)).toBe(true)
    expect(existsSync(join(paths.root, 'backups'))).toBe(false)
  })

  it('--apply backs up, applies and rewrites the memory files', async () => {
    const paths = dataDir()
    const ids = seed(paths)
    expect(readdirSync(paths.memoryDir).sort()).toEqual([
      'chemistry.md',
      'sn1-and-sn2-reactions-differ.md',
    ])
    const lines: string[] = []
    const code = await runCleanupCli(['--apply', '--merge-subject', MERGE.from, MERGE.into], {
      paths,
      probes: idle,
      log: (l) => lines.push(l),
      now: () => new Date('2026-10-24T18:00:00.000Z'),
    })
    expect(code, lines.join('\n')).toBe(0)
    const backup = join(paths.root, 'backups', '2026-10-24T18-00-00.000Z.db')
    const old = createSqliteRepos(backup, new FakeClock(), { readonly: true })
    expect(old.subjects.list()).toHaveLength(2)
    old.close()
    expect(readdirSync(paths.memoryDir)).toEqual(['chemistry.md'])
    const md = readFileSync(join(paths.memoryDir, 'chemistry.md'), 'utf8')
    expect(md).toContain('- backside attack')
    expect(md).not.toContain('Leaving Group —')
    expect(reopen(paths).concepts.listBySubject(ids.chem.id)).toHaveLength(4)
  })

  it('refuses --apply while Dumbledore runs, and rejects bad arguments', async () => {
    const paths = dataDir()
    seed(paths)
    const lines: string[] = []
    const running: GuardProbes = { processName: () => 'Dumbledore', holders: () => [4242] }
    const log = (l: string) => lines.push(l)
    expect(await runCleanupCli(['--apply'], { paths, probes: running, log })).toBe(3)
    expect(await runCleanupCli([], { paths, probes: running, log })).toBe(0)
    expect(await runCleanupCli(['--merge-subject', 'x'], { paths, probes: idle, log })).toBe(2)
    expect(await runCleanupCli(['--wat'], { paths, probes: idle, log })).toBe(2)
    expect(lines.join('\n')).toMatch(/Quit it first; nothing was changed/)
    expect(existsSync(join(paths.root, 'backups'))).toBe(false)
  })
})

describe('findRunningApp', () => {
  it('reads the singleton lock and test-control pid, ignoring stale ones', () => {
    const paths = dataDir()
    mkdirSync(paths.runDir, { recursive: true })
    symlinkSync('my-mac.local-111', join(paths.root, 'SingletonLock'))
    const names: Record<number, string> = { 111: 'Dumbledore', 222: 'Electron' }
    const probes: GuardProbes = { processName: (pid) => names[pid] ?? null, holders: () => [] }
    expect(findRunningApp(paths, probes)).toMatchObject({
      pid: 111,
      reason: expect.stringMatching(/SingletonLock/),
    })
    const stale: GuardProbes = { processName: () => null, holders: () => [] }
    expect(findRunningApp(paths, stale)).toBeNull()
    const reused: GuardProbes = { processName: () => 'zsh', holders: () => [] }
    expect(findRunningApp(paths, reused)).toBeNull()
    rmSync(join(paths.root, 'SingletonLock'))
    writeFileSync(join(paths.runDir, 'test-control.json'), JSON.stringify({ port: 1, pid: 222 }))
    expect(findRunningApp(paths, probes)).toMatchObject({
      pid: 222,
      reason: expect.stringMatching(/test-control/),
    })
  })

  it('asks lsof about the database files and the helper socket', () => {
    const paths = dataDir()
    seed(paths)
    const asked: string[][] = []
    const probes: GuardProbes = {
      processName: () => 'node',
      holders: (files) => {
        asked.push(files)
        return [process.pid, 31337]
      },
    }
    expect(findRunningApp(paths, probes)).toMatchObject({ pid: 31337 })
    expect(asked[0]).toContain(paths.dbFile)
  })
})
