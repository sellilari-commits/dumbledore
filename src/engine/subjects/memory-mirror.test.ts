import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import type { Repos } from '../contracts'
import { createEngineBus, type EngineBus } from '../events'
import { encounterInput } from '../store/conformance/fixtures'
import { createMemoryRepos } from '../testing/memory-repos'
import { createMemoryMirror, type MemoryMirrorHandle } from './memory-mirror'

describe('MemoryMirror', () => {
  let dir: string
  let clock: FakeClock
  let repos: Repos
  let bus: EngineBus
  let mirror: MemoryMirrorHandle
  const errors: unknown[] = []

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'dumbledore-memory-')), 'memory')
    clock = new FakeClock()
    repos = createMemoryRepos(clock)
    bus = createEngineBus()
    errors.length = 0
    mirror = createMemoryMirror({
      repos,
      clock,
      dir,
      bus,
      timeZone: 'UTC',
      onError: (e) => errors.push(e),
    })
  })
  afterEach(() => {
    mirror.dispose()
    rmSync(join(dir, '..'), { recursive: true, force: true })
    expect(errors).toEqual([])
  })

  const file = (name: string) => join(dir, name)
  const files = () => (existsSync(dir) ? readdirSync(dir).sort() : [])

  it('writes a subject file after the debounce, atomically', () => {
    const s = repos.subjects.create({ name: 'Organic Chemistry', emoji: '🧪' })
    repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
    mirror.regenerate(s.id)
    clock.advance(1999)
    expect(files()).toEqual([])
    clock.advance(1)
    expect(files()).toEqual(['organic-chemistry.md'])
    expect(readFileSync(file('organic-chemistry.md'), 'utf8')).toMatch(/^# 🧪 Organic Chemistry\n/)
    expect(readFileSync(file('organic-chemistry.md'), 'utf8')).toContain('- SN1 — New (0.00)')
    expect(mirror.pathFor(s.id)).toBe(file('organic-chemistry.md'))
  })

  it('restarts the debounce on new changes but never waits longer than maxWait', () => {
    const s = repos.subjects.create({ name: 'Chem' })
    for (let i = 0; i < 6; i++) {
      mirror.regenerate(s.id) // a change every 1.5 s keeps pushing the 2 s debounce back
      clock.advance(1500)
    }
    expect(files()).toEqual([]) // t = 9 s
    mirror.regenerate(s.id)
    clock.advance(1000) // t = 10 s: the 10 s cap since the first change wins over the debounce
    expect(files()).toEqual(['chem.md'])
  })

  it('follows memory:changed events, renames and removals', () => {
    const s = repos.subjects.create({ name: 'Chem' })
    const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
    bus.emit('memory:changed', { scope: 'concepts', ids: [c.id] })
    clock.advance(2000)
    expect(files()).toEqual(['chem.md'])

    repos.subjects.update(s.id, { name: 'Organic Chemistry' })
    bus.emit('memory:changed', { scope: 'subjects', ids: [s.id] })
    clock.advance(2000)
    expect(files()).toEqual(['organic-chemistry.md'])

    repos.encounters.add(encounterInput({ subjectId: s.id, seen: 'Carbocations!' }))
    bus.emit('memory:changed', { scope: 'inbox', ids: [] })
    clock.advance(2000)
    expect(readFileSync(file('organic-chemistry.md'), 'utf8')).toContain('**Seen:** Carbocations!')

    const other = repos.subjects.create({ name: 'Orgo' })
    mirror.regenerate(other.id)
    clock.advance(2000)
    expect(files()).toEqual(['organic-chemistry.md', 'orgo.md'])
    repos.subjects.merge(other.id, s.id)
    bus.emit('memory:changed', { scope: 'subjects', ids: [other.id, s.id] })
    clock.advance(2000)
    expect(files()).toEqual(['organic-chemistry.md'])
  })

  it('skips suggested subjects and leaves unchanged files alone', () => {
    const suggested = repos.subjects.create({ name: 'Geography', status: 'suggested' })
    const s = repos.subjects.create({ name: 'Chem' })
    mirror.regenerateAll()
    clock.advance(2000)
    expect(files()).toEqual(['chem.md'])
    expect(mirror.pathFor(suggested.id)).toBeNull()
    writeFileSync(file('chem.md'), 'hand edit')
    mirror.regenerate(s.id)
    mirror.flush()
    expect(readFileSync(file('chem.md'), 'utf8')).toBe('hand edit') // same content as last write → no write
  })

  it('regenerateAll sweeps stale files and leftovers; flush and dispose', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file('old-subject.md'), 'stale')
    writeFileSync(file('chem.md.123.4.tmp'), 'partial')
    repos.subjects.create({ name: 'Chem' })
    repos.subjects.create({ name: 'chem!' })
    mirror.regenerateAll()
    mirror.flush()
    const second = repos.subjects.list()[1]?.id.slice(-6)
    expect(files()).toEqual([`chem-${second}.md`, 'chem.md'].sort())
    mirror.regenerateAll()
    mirror.dispose()
    clock.advance(5000)
    bus.emit('memory:changed', { scope: 'subjects', ids: [] })
    expect(clock.pendingTimers()).toBe(0)
  })
})
