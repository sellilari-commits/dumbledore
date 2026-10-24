/**
 * Live prompt evals (docs/PLAN.md §9.2) against Gemini (paid, primary) or the free providers.
 * Results → docs/evals/<date>-<suite>.md (with the estimated spend) + docs/evals/history.jsonl.
 *
 *   npx tsx tools/eval-prompts.ts [extraction|roadmaps|quizzes|prompts|all] [--limit N] [--only R]
 *       [--provider gemini|ovh|groq|mistral] [--route tier=provider:model] [--concurrency N]
 *       [--max-eur 0.5] [--no-write]
 *
 * tsx reads the root tsconfig.json, which has no path aliases, so this launcher re-runs itself
 * with --tsconfig tsconfig.node.json; the eval code lives in src/engine/brain/evals/.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')

async function run(): Promise<void> {
  if (process.env.DUMBLEDORE_EVAL_CHILD !== '1') {
    const tsxCli = require.resolve('tsx/cli', { paths: [root] })
    const child = spawnSync(
      process.execPath,
      [
        tsxCli,
        '--tsconfig',
        resolve(root, 'tsconfig.node.json'),
        __filename,
        ...process.argv.slice(2),
      ],
      { cwd: root, stdio: 'inherit', env: { ...process.env, DUMBLEDORE_EVAL_CHILD: '1' } },
    )
    process.exit(child.status ?? 1)
  }
  const { main } = await import('../src/engine/brain/evals/cli')
  process.exit(await main(process.argv.slice(2), root))
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
