/**
 * `createSqliteRepos(dbPath, clock)`: the production `Repos`, backed by better-sqlite3.
 *
 * Behaves exactly like the in-memory twin (engine/testing/memory-repos.ts); the shared
 * conformance suite (repos.conformance.ts) runs against both. Extras beyond the contract:
 * `close()`, the raw `db`, and `relink` (moving a concept / re-pointing an encounter, which the
 * Repos contract can't express yet — SubjectService uses it when present).
 */
import type { Id } from '@shared/domain'
import type { Clock } from '../clock'
import type { Repos } from '../contracts'
import type { StoreCtx } from './context'
import { type Db, openDatabase, statementCache } from './db'
import { createConceptRepo } from './repos/concepts'
import { createEncounterRepo, createEpisodeRepo } from './repos/encounters'
import { createProfileRepo, createSettingsRepo, createUsageRepo } from './repos/profile'
import { createQuizRepo } from './repos/quizzes'
import { createAssignmentRepo, createChatRepo, createNudgeRepo } from './repos/records'
import { createRoadmapRepo } from './repos/roadmaps'
import { createSearchRepo } from './repos/search'
import { createSubjectRepo } from './repos/subjects'
import { createSearchIndex } from './search-index'

/** Writes the Repos contract lacks (requested as a contract change; see docs/progress/L2a-store.md). */
export interface RelinkSupport {
  /** Moves a concept (and its search entry) to another subject, keeping its id and stats. */
  moveConcept(conceptId: Id, subjectId: Id): void
  /** Re-points an encounter at another concept (or none). */
  setEncounterConcept(encounterId: Id, conceptId: Id | null): void
}

export interface SqliteRepos extends Repos {
  readonly db: Db
  readonly relink: RelinkSupport
  close(): void
}

export function createSqliteRepos(dbPath: string, clock: Clock): SqliteRepos {
  const db = openDatabase(dbPath, { nowIso: clock.nowIso() })
  const ctx: StoreCtx = {
    db,
    stmt: statementCache(db),
    now: () => clock.nowIso(),
    index: createSearchIndex(db),
  }
  const concepts = createConceptRepo(ctx)
  const encounters = createEncounterRepo(ctx)
  return {
    db,
    subjects: createSubjectRepo(ctx),
    concepts,
    encounters,
    episodes: createEpisodeRepo(ctx),
    roadmaps: createRoadmapRepo(ctx),
    quizzes: createQuizRepo(ctx),
    assignments: createAssignmentRepo(ctx),
    nudges: createNudgeRepo(ctx),
    chat: createChatRepo(ctx),
    profile: createProfileRepo(ctx),
    settings: createSettingsRepo(ctx),
    usage: createUsageRepo(ctx),
    search: createSearchRepo(ctx),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    relink: {
      moveConcept: (conceptId, subjectId) => void concepts.moveToSubject(conceptId, subjectId),
      setEncounterConcept: (encounterId, conceptId) =>
        void encounters.setConcept(encounterId, conceptId),
    },
    close: () => {
      if (db.open) db.close()
    },
  }
}
