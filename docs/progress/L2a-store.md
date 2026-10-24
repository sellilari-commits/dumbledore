# L2a Store — status
Updated: 2026-10-24T19:15:00Z

## Scope
- ✅ Read plan + contracts
- ✅ SQLite storage: db.ts (WAL, FK, busy timeout), migrations.ts (schema_version), schema-v1.ts, FTS5 trigram index (search-index.ts)
- ✅ createSqliteRepos(dbPath, clock) (store/sqlite-repos.ts + store/repos/*); extras: close(), db, relink
- ✅ Conformance suite store/conformance/* — 41 tests × (memory, sqlite) green; sqlite-only tests in sqlite-repos.test.ts
- ✅ Data paths module (store/paths.ts, DUMBLEDORE_DATA_DIR override)
- ✅ QueryService (src/engine/queries) — tested on seeded data against memory + sqlite
- ✅ SubjectService + emoji table (src/engine/subjects) — tested on memory + sqlite (relink path)
- ✅ MemoryMirror (subjects/memory-mirror.ts + memory-format.ts) — debounce/maxWait/atomic/sweep tested
- ✅ Demo seed: store/seed/* + tools/seed-demo.ts (`npx tsx tools/seed-demo.ts [db] [--reset] [--memory]`), tested incl. real tsx run
- ✅ 165 tests green (also under TZ=America/New_York, Pacific/Kiritimati, UTC); tsc + biome clean on owned paths

## Next
1. Self-review pass; final report.

## Open issues / requests for the integrator
- Contract gap: EncounterRepo can't change conceptId and ConceptRepo.update can't change subjectId, so
  "assign moves the encounter and its concept" needs `SqliteRepos.relink` (moveConcept, setEncounterConcept).
  Request: add both to the Repos contract + memory twin.
- Memory-twin quirks (not edited; SQLite does the intended thing): openQuestions(id, 0) returns 1 item;
  chat.history(t, 0) returns the whole thread; upsert with parentName == name creates a duplicate;
  merge(x, x) deletes all of x's concepts and x; merge leaves quiz question conceptIds dangling;
  explicit `undefined` in patches overwrites fields; transaction() can't roll back.
- SQLite enforces FKs (concept/roadmap → subject, encounter/assignment → subject/concept), so dangling
  ids that the twin accepts throw.
