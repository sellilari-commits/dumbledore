/**
 * MemoryMirror: keeps `memory/<slug>.md` in sync with the database, one Markdown file per
 * (non-suggested) subject. Writes are debounced (~2 s, capped at 10 s under constant change),
 * atomic (tmp file + rename) and skipped when the content is unchanged. With a bus it follows
 * 'memory:changed' by itself; `flush()` writes everything pending now (shutdown, tests).
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Id, Subject } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import type { Cancel, Clock } from '../clock'
import type { MemoryMirror, Repos } from '../contracts'
import type { EngineBus } from '../events'
import { summarizeSubject } from '../queries/summary'
import { formatMemoryFile } from './memory-format'
import { slugsFor } from './slug'

export interface MemoryMirrorOptions {
  repos: Repos
  clock: Clock
  /** The memory/ folder (DataPaths.memoryDir). */
  dir: string
  /** When given, regenerates the affected subjects on 'memory:changed'. */
  bus?: EngineBus
  debounceMs?: number
  /** Longest a pending change waits while changes keep coming. */
  maxWaitMs?: number
  /** IANA zone for dates in the files; defaults to the system zone. */
  timeZone?: string
  onError?: (error: unknown) => void
}

export interface MemoryMirrorHandle extends MemoryMirror {
  /** Writes everything pending now. */
  flush(): void
  /** Cancels timers and stops listening to the bus. */
  dispose(): void
  /** Absolute path of a subject's file (null for unknown or suggested subjects). */
  pathFor(subjectId: Id): string | null
}

let tmpCounter = 0

export function createMemoryMirror(opts: MemoryMirrorOptions): MemoryMirrorHandle {
  const { repos, clock, dir } = opts
  const debounceMs = opts.debounceMs ?? 2000
  const maxWaitMs = opts.maxWaitMs ?? 10_000
  const onError = opts.onError ?? ((e: unknown) => console.error('[memory-mirror]', e))
  const pending = new Set<Id>()
  let all = false
  let timer: Cancel | null = null
  let firstPendingAt: number | null = null
  const written = new Map<Id, string>() // subject → file path
  const contents = new Map<string, string>() // file path → last content written

  const mirrored = (s: Subject) => s.status !== 'suggested'
  const paths = (): Map<Id, string> => {
    const slugs = slugsFor(repos.subjects.list().filter(mirrored))
    return new Map([...slugs].map(([id, slug]) => [id, join(dir, `${slug}.md`)]))
  }

  const remove = (path: string) => {
    rmSync(path, { force: true })
    contents.delete(path)
  }

  const writeAtomic = (path: string, content: string) => {
    if (contents.get(path) === content) return
    mkdirSync(dir, { recursive: true })
    const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
    contents.set(path, content)
  }

  const render = (subject: Subject): string =>
    formatMemoryFile(
      {
        subject: summarizeSubject(repos, subject, clock.now()),
        concepts: repos.concepts.listBySubject(subject.id),
        encounters: repos.encounters.list({ subjectId: subject.id, limit: 500 }),
        quizzes: repos.quizzes.list({ subjectId: subject.id, limit: 20 }),
        notes: repos.notes.list({ subjectId: subject.id }),
      },
      { timeZone: opts.timeZone },
    )

  /** Writes (or removes) one subject's file; returns false when the subject has no file now. */
  const writeSubject = (id: Id, pathMap: Map<Id, string>): boolean => {
    const previous = written.get(id)
    const subject = repos.subjects.get(id)
    const path = subject && mirrored(subject) ? pathMap.get(id) : undefined
    if (previous && previous !== path) remove(previous)
    if (!subject || !path) {
      written.delete(id)
      return false
    }
    writeAtomic(path, render(subject))
    written.set(id, path)
    return true
  }

  /** Deletes .md files that belong to no mirrored subject (renamed, merged, suggested again). */
  const sweep = (pathMap: Map<Id, string>) => {
    const keep = new Set(pathMap.values())
    mkdirSync(dir, { recursive: true })
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if ((name.endsWith('.md') && !keep.has(path)) || name.endsWith('.tmp')) remove(path)
    }
  }

  const flush = () => {
    timer?.()
    timer = null
    firstPendingAt = null
    const ids = all ? null : [...pending]
    let needsSweep = all
    pending.clear()
    all = false
    try {
      const pathMap = paths()
      for (const id of ids ?? [...pathMap.keys()]) {
        try {
          if (!writeSubject(id, pathMap)) needsSweep = true
        } catch (error) {
          onError(error)
        }
      }
      if (needsSweep) sweep(pathMap)
    } catch (error) {
      onError(error)
    }
  }

  const schedule = () => {
    const now = clock.now()
    firstPendingAt ??= now
    timer?.()
    const delay = Math.max(0, Math.min(debounceMs, firstPendingAt + maxWaitMs - now))
    timer = clock.setTimeout(flush, delay)
  }

  const subjectsFor = (change: MemoryChanged): Id[] | 'all' | null => {
    switch (change.scope) {
      case 'subjects':
        return change.ids
      case 'concepts':
        return change.ids.flatMap((id) => repos.concepts.get(id)?.subjectId ?? [])
      case 'quizzes':
        return change.ids.flatMap((id) => repos.quizzes.get(id)?.subjectIds ?? [])
      case 'roadmaps':
        return change.ids.flatMap((id) => repos.roadmaps.get(id)?.subjectId ?? [])
      case 'inbox':
        return 'all' // encounters can't be looked up by id; unchanged files are not rewritten
      default:
        return null
    }
  }

  const mirror: MemoryMirrorHandle = {
    regenerate(subjectId) {
      pending.add(subjectId)
      schedule()
    },
    regenerateAll() {
      all = true
      schedule()
    },
    flush,
    dispose() {
      timer?.()
      timer = null
      off?.()
    },
    pathFor: (subjectId) => paths().get(subjectId) ?? null,
  }

  const off = opts.bus?.on('memory:changed', (change) => {
    try {
      const ids = subjectsFor(change)
      if (ids === 'all') {
        for (const id of paths().keys()) mirror.regenerate(id)
      } else if (ids) {
        for (const id of ids) mirror.regenerate(id)
      }
    } catch (error) {
      onError(error)
    }
  })

  return mirror
}
