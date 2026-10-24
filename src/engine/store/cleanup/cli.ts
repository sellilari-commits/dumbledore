/**
 * The memory-cleanup command behind tools/cleanup-memory.ts:
 *
 *   cleanup-memory [--apply] [--merge-subject "<from name>" "<into name>"]
 *
 * Default is a dry run: it prints the plan (duplicate concepts per subject and what each folds
 * into; the subject merge) through a read-only connection and changes nothing, so it may run next
 * to the app. --apply refuses while Dumbledore runs on the data folder; otherwise it backs the
 * database up with SQLite's online backup to <data>/backups/<ISO time>.db, applies the plan in one
 * transaction and regenerates the Markdown memory files (the merged-away subject's file goes).
 * Data folder: DUMBLEDORE_DATA_DIR, else ~/Library/Application Support/Dumbledore.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Id } from '@shared/domain'
import Database from 'better-sqlite3'
import { systemClock } from '../../clock'
import { createMemoryMirror } from '../../subjects/memory-mirror'
import type { Db } from '../db'
import { type DataPaths, resolveDataPaths } from '../paths'
import { createSqliteRepos, type SqliteRepos } from '../sqlite-repos'
import { applyCleanup } from './apply'
import { findRunningApp, type GuardProbes, systemProbes } from './guard'
import { type CleanupPlan, formatPlan, isEmptyPlan, type MergeRequest, planCleanup } from './plan'

export const CLEANUP_USAGE =
  'usage: npx tsx --tsconfig tsconfig.node.json tools/cleanup-memory.ts [--apply] [--merge-subject "<from name>" "<into name>"]'

export interface CleanupCliOptions {
  paths?: DataPaths
  probes?: GuardProbes
  log?: (line: string) => void
  now?: () => Date
}

interface Args {
  apply: boolean
  help: boolean
  merge: MergeRequest | null
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { apply: false, help: false, merge: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') args.apply = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--merge-subject') {
      const [from, into] = [argv[i + 1], argv[i + 2]]
      if (!from?.trim() || !into?.trim() || from.startsWith('--') || into.startsWith('--'))
        return '--merge-subject needs two subject names'
      if (args.merge) return '--merge-subject can be given once'
      args.merge = { from, into }
      i += 2
    } else return `unknown argument: ${arg}`
  }
  return args
}

/** Online backup to <data>/backups/<ISO time>.db, as one self-contained file, then checked. */
async function backupDatabase(db: Db, paths: DataPaths, now: Date): Promise<string> {
  const dir = join(paths.root, 'backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${now.toISOString().replace(/:/g, '-')}.db`)
  await db.backup(file)
  const copy = new Database(file)
  try {
    copy.pragma('journal_mode = DELETE')
    const check = copy.pragma('integrity_check', { simple: true })
    const count = (d: Db, table: string) => d.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()
    const same = ['subjects', 'concepts', 'encounters'].every(
      (t) => count(copy, t) === count(db, t),
    )
    if (check !== 'ok' || !same) throw new Error(`backup ${file} does not match the database`)
  } finally {
    copy.close()
  }
  return file
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function conceptList(repos: SqliteRepos, subjectId: Id): string {
  return repos.concepts
    .listBySubject(subjectId)
    .map((c) => c.name)
    .join(', ')
}

function apply(
  repos: SqliteRepos,
  plan: CleanupPlan,
  args: Args,
  paths: DataPaths,
  log: (line: string) => void,
): number {
  const errors: unknown[] = []
  const mirror = createMemoryMirror({
    repos,
    clock: systemClock,
    dir: paths.memoryDir,
    onError: (error) => errors.push(error),
  })
  try {
    const stale = plan.merge ? mirror.pathFor(plan.merge.fromId) : null
    try {
      applyCleanup(repos, plan, args.merge)
    } catch (error) {
      throw new Error(`${messageOf(error)}; the transaction rolled back, nothing was changed`)
    }
    log('Applied in one transaction.')
    mirror.regenerateAll()
    mirror.flush()
    const live = new Set(repos.subjects.list().map((s) => mirror.pathFor(s.id)))
    if (stale && !live.has(stale)) {
      rmSync(stale, { force: true }) // the mirror's sweep normally got it already
      log(`Removed memory file ${basename(stale)}`)
    }
    const touched = new Set([...plan.groups.map((g) => g.subjectId), plan.merge?.intoId])
    for (const id of touched) {
      const subject = id ? repos.subjects.get(id) : null
      if (!subject) continue
      const file = mirror.pathFor(subject.id)
      log(`${subject.name}: ${conceptList(repos, subject.id)}`)
      if (file) log(`  memory file: ${basename(file)}`)
    }
  } finally {
    mirror.dispose()
  }
  for (const error of errors) log(`Memory file error: ${String(error)}`)
  return errors.length > 0 ? 1 : 0
}

/** Returns the process exit code: 0 ok, 1 error, 2 bad arguments, 3 Dumbledore is running. */
export async function runCleanupCli(
  argv: readonly string[],
  opts: CleanupCliOptions = {},
): Promise<number> {
  const log = opts.log ?? console.log
  const args = parseArgs(argv)
  if (typeof args === 'string' || args.help) {
    if (typeof args === 'string') log(args)
    log(CLEANUP_USAGE)
    return typeof args === 'string' ? 2 : 0
  }
  const paths = opts.paths ?? resolveDataPaths()
  if (!existsSync(paths.dbFile)) {
    log(`No database at ${paths.dbFile}`)
    return 1
  }
  const running = findRunningApp(paths, opts.probes ?? systemProbes)
  if (running && args.apply) {
    log(
      `Dumbledore is running (pid ${running.pid}; ${running.reason}). Quit it first; nothing was changed.`,
    )
    return 3
  }
  log(`Data folder: ${paths.root}`)
  if (running) log(`Dumbledore is running (pid ${running.pid}); this dry run only reads.`)

  let plan: CleanupPlan
  const reader = createSqliteRepos(paths.dbFile, systemClock, { readonly: true })
  try {
    plan = planCleanup(reader, args.merge)
    for (const line of formatPlan(plan)) log(line)
    if (!args.apply) {
      log('Dry run: nothing was changed. Add --apply to do it (quit Dumbledore first).')
      return 0
    }
    if (isEmptyPlan(plan)) {
      log('Nothing to do.')
      return 0
    }
    log(`Backup: ${await backupDatabase(reader.db, paths, (opts.now ?? (() => new Date()))())}`)
  } catch (error) {
    log(`Error: ${messageOf(error)}`)
    return 1
  } finally {
    reader.close()
  }

  const repos = createSqliteRepos(paths.dbFile, systemClock)
  try {
    return apply(repos, plan, args, paths, log)
  } catch (error) {
    log(`Error: ${messageOf(error)}`)
    return 1
  } finally {
    repos.close()
  }
}
