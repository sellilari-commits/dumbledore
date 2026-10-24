/**
 * Seeds a realistic demo database (3 subjects, concepts, encounters, a roadmap halfway through,
 * exams, assignments, profile, chat and LLM usage):
 *
 *   npx tsx tools/seed-demo.ts [dbPath] [--reset] [--memory]
 *
 * Without dbPath it seeds the app's own database (~/Library/Application Support/Dumbledore) and
 * refuses to touch one that already has data unless --reset is given. The logic lives in
 * src/engine/store/seed (shared with the tests); this file only bootstraps it.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const tsconfig = resolve(__dirname, '..', 'tsconfig.node.json')

if (process.env.TSX_TSCONFIG_PATH !== tsconfig) {
  // The root tsconfig.json has no `paths`; re-run under tsconfig.node.json so @shared/* and
  // @engine/* resolve. execArgv carries tsx's loader flags into the child.
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig } },
  )
  process.exit(child.status ?? 1)
} else {
  import('../src/engine/store/seed/cli')
    .then(({ runSeedCli }) => {
      process.exitCode = runSeedCli(process.argv.slice(2))
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
