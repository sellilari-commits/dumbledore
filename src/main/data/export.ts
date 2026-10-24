/**
 * "Export everything" (Settings → Data): one JSON snapshot of every record Dumbledore keeps,
 * read through the Repos interface, so it works on the SQLite store and on the in-memory twin.
 * API keys are never included (settings carry only the "key is set" flags). The file is written
 * to <data dir>/exports/ and is readable by the owner only.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repos } from '@engine/contracts'

export const EXPORT_FORMAT = 'dumbledore-export'
export const EXPORT_VERSION = 1
const EPOCH = '1970-01-01T00:00:00.000Z'
/** Chat threads of Dumbledore's own surfaces; per-subject chats use `subject:<id>`. */
const CHAT_THREADS = ['ask', 'panel', 'app']

export interface ExportMeta {
  appVersion: string
  exportedAt: string
}

export function buildExport(repos: Repos, meta: ExportMeta) {
  const subjects = repos.subjects.list()
  const threads = [...CHAT_THREADS, ...subjects.map((s) => `subject:${s.id}`)]
  const chat = Object.fromEntries(
    threads
      .map((thread) => [thread, repos.chat.history(thread, Number.MAX_SAFE_INTEGER)] as const)
      .filter(([, messages]) => messages.length > 0),
  )
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    appVersion: meta.appVersion,
    exportedAt: meta.exportedAt,
    profile: repos.profile.get(),
    settings: repos.settings.get(),
    subjects,
    concepts: subjects.flatMap((s) => repos.concepts.listBySubject(s.id)),
    roadmaps: subjects.flatMap((s) => repos.roadmaps.listBySubject(s.id)),
    encounters: repos.encounters.list({}),
    notes: repos.notes.list({ status: null }),
    conceptEdges: subjects.flatMap((s) => repos.edges.list(s.id)),
    episodes: repos.episodes.recent({ sinceIso: EPOCH }),
    quizzes: repos.quizzes.list({}),
    assignments: repos.assignments.list({}),
    nudges: repos.nudges.listSince(EPOCH),
    chat,
    usage: repos.usage.rowsSince(EPOCH),
  }
}

export type DataExport = ReturnType<typeof buildExport>

/** "2026-10-24T18:45:12.345Z" → "dumbledore-export-2026-10-24T18-45-12-345Z.json". */
export function exportFileName(exportedAt: string): string {
  return `dumbledore-export-${exportedAt.replace(/[:.]/g, '-')}.json`
}

/** Writes the export into `dir` (created 0700 if missing) and returns the file path. */
export function writeExport(dir: string, data: DataExport): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, exportFileName(data.exportedAt))
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}
