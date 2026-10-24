# V Memory dedupe — status
Updated: 2026-10-24T20:16:00+03:00

## Scope
- ✅ Concept matching: store/concept-key.ts (conceptKey, singularize, isNicerName). Same concept = equal key after
  ignoring case, spacing, hyphens/punctuation, possessive 's, simple plurals (conservative; analysis/mass/species/
  physics/gas/status… unchanged; symbols significant: C++ ≠ C). Upsert keeps the existing concept; renames only to a
  clearly nicer name (capitals where the old one had none).
- ✅ SQLite matches in JS (repos/concept-rows.ts findConceptSeq); `name_key` keeps normalizeName() so older app builds
  still find concepts after the cleanup (no rekey, no schema change). Twin (testing/memory-repos.ts) does the same.
- ✅ SubjectRepo.merge folds equal concepts (store/concept-fold.ts pure combine; repos/concept-rows.ts foldConcept;
  twin foldConcept): mastery/box max, struggles summed, latest lastSeen, sooner nextReview, struggling wins, summary
  filled; children, encounters, quiz question conceptIds, chat/nudge start_review ids re-pointed; search index updated.
  Roadmap items reference concepts by name (resolve via conceptKey), nothing to rewrite.
- ✅ Twin quirks fixed: merge(x, x) is a no-op (SQLite too; it used to throw), quiz conceptIds no longer dangle,
  upsert with parentName == name no longer duplicates.
- ✅ createSqliteRepos(path, clock, { readonly }) (no migrations, no profile insert); relink.mergeConcepts.
- ✅ store/cleanup/{plan,apply,guard,cli}.ts + tools/cleanup-memory.ts. Dry run read-only (allowed while the app runs,
  prints a note); --apply refuses while running (exit 3), backs up via db.backup to <data>/backups/<ISO, ':'→'-'>.db
  (journal_mode DELETE, integrity + row counts checked), re-plans inside one transaction and verifies the outcome,
  regenerates memory files, removes the merged-away subject's .md.
- ✅ Tested on scratch copies (work1 from 19:55 copy, work3 from a 20:11 online-backup snapshot): Chemistry ends with
  10 concepts, SN1 subject gone, sn1 .md removed, FK/integrity ok, second run finds nothing.
- ✅ Tests: concept-key.test.ts, concept-dedupe.test.ts, cleanup/cleanup.test.ts, conformance/concept-matching.ts
  (7 × 2). vitest src/engine src/main tests/unit tests/integration: 1002 passed; tsc 0; biome clean.

## Next
1. Coordinator: quit Dumbledore, then from the repo root:
   `npx tsx --tsconfig tsconfig.node.json tools/cleanup-memory.ts --apply --merge-subject "SN1 and SN2 reactions differ" "Chemistry"`

## Open issues / requests for the integrator
- Request (queries lane): src/engine/queries/struggle.ts matches question conceptName with normalizeName; use
  conceptKey (store/concept-key.ts) so "nucleophiles" questions count for "Nucleophile".
- Observation: extraction created a concept "Chemistry" inside "SN1 and SN2 reactions differ" (17:08 UTC, from the
  topic path root); the merge moves it into Chemistry as a concept named like its subject.
- Moved concepts keep their row order, so "backside attack" lists first in Chemistry (it is older).
