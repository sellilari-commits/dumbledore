/** Runs the shared Repos conformance suite against the in-memory twin and SQLite. */
import { createMemoryRepos } from '../testing/memory-repos'
import { describeReposConformance } from './conformance'
import { createSqliteRepos } from './sqlite-repos'

describeReposConformance('memory', (clock) => ({ repos: createMemoryRepos(clock) }))

describeReposConformance('sqlite', (clock) => {
  const repos = createSqliteRepos(':memory:', clock)
  return { repos, cleanup: () => repos.close() }
})
