/**
 * The demo-seed command behind tools/seed-demo.ts:
 *
 *   seed-demo [dbPath] [--reset] [--memory]
 *
 * Without dbPath it seeds the app's own database. A database that already has subjects is left
 * alone unless --reset is given (which deletes it first). --memory also writes the per-subject
 * Markdown memory files into `<db folder>/memory/`.
 */
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createMemoryMirror } from '../../subjects/memory-mirror'
import { resolveDataPaths } from '../paths'
import { createSqliteRepos } from '../sqlite-repos'
import { seedDemo } from './demo-seed'
import { ManualClock } from './manual-clock'

const USAGE = 'usage: npx tsx tools/seed-demo.ts [dbPath] [--reset] [--memory]'

function hasSubjects(dbPath: string): boolean {
  const repos = createSqliteRepos(dbPath, new ManualClock())
  try {
    return repos.subjects.list().length > 0
  } finally {
    repos.close()
  }
}

/** Returns the process exit code. */
export function runSeedCli(argv: string[], log: (line: string) => void = console.log): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const [pathArg, ...rest] = argv.filter((a) => !a.startsWith('--'))
  const unknown = [...flags].filter((f) => !['--reset', '--memory', '--help'].includes(f))
  if (flags.has('--help') || unknown.length > 0 || rest.length > 0) {
    log(USAGE)
    return flags.has('--help') ? 0 : 2
  }
  const dbPath = pathArg ? resolve(pathArg) : resolveDataPaths().dbFile

  if (existsSync(dbPath) && hasSubjects(dbPath)) {
    if (!flags.has('--reset')) {
      log(`${dbPath} already has data; pass --reset to replace it with the demo.`)
      return 1
    }
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  }

  const clock = new ManualClock(Date.now())
  const repos = createSqliteRepos(dbPath, clock)
  try {
    const result = seedDemo(repos, clock)
    const { counts } = result
    log(`Seeded ${dbPath}`)
    log(
      `  ${Object.values(result.subjects)
        .map((s) => `${s.emoji} ${s.name} (${s.status})`)
        .join(', ')}`,
    )
    log(
      `  ${counts.concepts} concepts · ${counts.encounters} encounters · ${counts.quizzes} quizzes · ${counts.assignments} assignments · ${counts.llmCalls} LLM calls`,
    )
    if (flags.has('--memory')) {
      const dir = join(dirname(dbPath), 'memory')
      const mirror = createMemoryMirror({ repos, clock, dir })
      mirror.regenerateAll()
      mirror.flush()
      log(`  memory files in ${dir}`)
    }
    return 0
  } finally {
    repos.close()
  }
}
