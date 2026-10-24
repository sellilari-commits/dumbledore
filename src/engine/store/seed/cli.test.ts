import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { createSqliteRepos } from '../sqlite-repos'
import { runSeedCli } from './cli'

const ROOT = resolve(__dirname, '../../../..')

describe('seed-demo', () => {
  const dirs: string[] = []
  const tempDb = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumbledore-seed-'))
    dirs.push(dir)
    return join(dir, 'demo.db')
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('seeds a fresh database, refuses to overwrite data, and resets on request', () => {
    const db = tempDb()
    const log: string[] = []
    expect(runSeedCli([db, '--memory'], (l) => log.push(l))).toBe(0)
    expect(log.join('\n')).toContain('22 concepts · 25 encounters · 4 quizzes')
    expect(readdirSync(join(db, '..', 'memory')).sort()).toEqual([
      'linear-algebra.md',
      'organic-chemistry.md',
    ])
    expect(runSeedCli([db], () => {})).toBe(1)
    expect(runSeedCli([db, '--reset'], () => {})).toBe(0)
    const repos = createSqliteRepos(db, new FakeClock())
    expect(repos.subjects.list()).toHaveLength(3)
    repos.close()
    expect(runSeedCli([db, '--bogus'], () => {})).toBe(2)
  })

  it('runs as `tsx tools/seed-demo.ts <dbPath>`', () => {
    const db = tempDb()
    const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const run = spawnSync(process.execPath, [tsx, 'tools/seed-demo.ts', db], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TSX_TSCONFIG_PATH: '' },
    })
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('Seeded')
    expect(existsSync(db)).toBe(true)
  }, 30_000)
})
