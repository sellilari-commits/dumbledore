/**
 * One-off memory cleanup: folds duplicate concepts ("Leaving groups" / "Leaving Group") inside
 * every subject and, optionally, merges one subject into another:
 *
 *   npx tsx --tsconfig tsconfig.node.json tools/cleanup-memory.ts [--apply] \
 *     [--merge-subject "<from name>" "<into name>"]
 *
 * Without --apply it is a dry run that prints the plan and changes nothing. With --apply it
 * refuses while Dumbledore is running, backs the database up to <data>/backups/<ISO time>.db,
 * applies everything in one transaction and regenerates the memory files. The data folder is
 * DUMBLEDORE_DATA_DIR or ~/Library/Application Support/Dumbledore. The logic lives in
 * src/engine/store/cleanup (tested there); this file only bootstraps it.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const tsconfig = resolve(__dirname, '..', 'tsconfig.node.json')

if (process.env.TSX_TSCONFIG_PATH !== tsconfig) {
  // @shared/* and @engine/* resolve only under tsconfig.node.json; re-run with it pinned.
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig } },
  )
  process.exit(child.status ?? 1)
} else {
  import('../src/engine/store/cleanup/cli')
    .then(async ({ runCleanupCli }) => {
      process.exitCode = await runCleanupCli(process.argv.slice(2))
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
