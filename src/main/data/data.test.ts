import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '@engine/clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { afterEach, describe, expect, it } from 'vitest'
import { seedDemo } from '../fakes/seed'
import { resolvePaths } from '../paths'
import { buildExport, exportFileName, writeExport } from './export'
import { dataFiles, wipeDataFiles } from './wipe'

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-data-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('data export', () => {
  it('collects every record through the repos', () => {
    const clock = new FakeClock()
    const repos = createMemoryRepos(clock)
    seedDemo(repos, clock)
    repos.chat.append({ thread: 'ask', role: 'user', content: 'Why SN1?', actions: [] })
    const data = buildExport(repos, { appVersion: '1.2.3', exportedAt: clock.nowIso() })
    expect(data).toMatchObject({ format: 'dumbledore-export', version: 1, appVersion: '1.2.3' })
    expect(data.subjects.map((s) => s.status).sort()).toContain('suggested')
    expect(data.subjects.length).toBe(repos.subjects.list().length)
    expect(data.encounters.length).toBe(repos.encounters.list({}).length)
    expect(data.concepts.length).toBeGreaterThan(0)
    expect(data.settings.ai).not.toHaveProperty('groqKey')
    expect(data.chat).toEqual({ ask: [expect.objectContaining({ content: 'Why SN1?' })] })
  })

  it('writes an owner-only file named after the export time', () => {
    const dir = join(tempDir(), 'exports')
    const repos = createMemoryRepos(new FakeClock())
    const data = buildExport(repos, { appVersion: '1', exportedAt: '2026-10-24T18:45:12.345Z' })
    const file = writeExport(dir, data)
    expect(file).toBe(join(dir, 'dumbledore-export-2026-10-24T18-45-12-345Z.json'))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(file, 'utf8')).exportedAt).toBe('2026-10-24T18:45:12.345Z')
    expect(exportFileName('2026-01-02T03:04:05.006Z')).not.toMatch(/[:]/)
  })
})

describe('delete everything (files)', () => {
  it('removes the database, memory files, exports and keys, and nothing else', () => {
    const root = tempDir()
    const paths = resolvePaths('/unused', { DUMBLEDORE_DATA_DIR: root })
    expect(paths.dataDir).toBe(root)
    mkdirSync(paths.memoryDir, { recursive: true })
    mkdirSync(paths.exportsDir, { recursive: true })
    mkdirSync(paths.runDir, { recursive: true })
    mkdirSync(paths.chromiumDir, { recursive: true })
    for (const file of [paths.dbFile, `${paths.dbFile}-wal`, paths.secretsFile]) {
      writeFileSync(file, 'x')
    }
    writeFileSync(join(paths.memoryDir, 'organic-chemistry.md'), '# 🧪 Organic Chemistry')
    writeFileSync(join(paths.runDir, 'helper.sock'), '')

    const removed = wipeDataFiles(paths)
    expect(removed.sort()).toEqual(
      [
        paths.dbFile,
        `${paths.dbFile}-wal`,
        paths.memoryDir,
        paths.exportsDir,
        paths.secretsFile,
      ].sort(),
    )
    for (const path of dataFiles(paths)) expect(() => statSync(path)).toThrow()
    expect(statSync(paths.runDir).isDirectory()).toBe(true)
    expect(statSync(paths.chromiumDir).isDirectory()).toBe(true)
    expect(wipeDataFiles(paths)).toEqual([])
  })
})
