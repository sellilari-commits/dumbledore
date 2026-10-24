# Structured notes — design

Status: approved 2026-10-24 (decisions in §10), phase 1 built · builds on PLAN.md §6.7 (data model) and §6.6 (roadmaps)

## Summary

- **Problem.** Memory today is a flat pile: concepts with a loose `parent_id`, and encounters, each a
  paragraph (`seen`, `bigPicture`, `topicPath`). Nothing rolls them up. The roadmap gets a flat
  mastery list plus raw encounters, with no order and no prerequisites.
- **Shape.** subject ▸ topic tree (the concepts we already have) ▸ **atomic notes** (one fact each,
  linked to a concept and its source), plus **prerequisite edges** between concepts.
- **Write path.** The extractor also returns 1–5 short notes per item, and highlights become notes
  directly. Each note is placed by name (`conceptKey`); the LLM is used only when the match is
  ambiguous.
- **Consolidation.** One call per subject after about 10 new notes, or nightly. It rewrites concept
  summaries from their notes, merges duplicates, fixes the tree and adds prerequisite edges.
- **Read path.** The roadmap gets the tree, edges, mastery, key notes and open questions. Steps
  follow prerequisite order, start where the student is and skip mastered concepts.
- **Control.** The subject page shows the tree, each concept's summary and its notes; every note,
  concept and encounter can be edited and deleted.
- **Cost.** Notes add about 150 output tokens per extraction call. Consolidation is about 1 call per
  active subject per day.
- **Build.** 3 phases with separate files, so the lanes can run in parallel.

## 1. What exists today

| Piece | Where | Notes |
|---|---|---|
| Subject | `subjects` | name, goal, deadline, status |
| Concept | `concepts` (`subject_id`, `parent_id`, `name`, `summary`, mastery, Leitner box…) | Built by `upsertChain` (extraction/apply.ts) from `topicPath`, at most 4 levels, the leaf's `summary` = first 240 characters of `seen`. Dedupe by `conceptKey` (case, plurals, punctuation) and `foldConcept`. |
| Encounter | `encounters` | One per extracted item: `seen` (≤60 words), `bigPicture`, `topicPath`, understanding + evidence, open questions, key terms, source app/url/title. |
| Memory file | `memory/<slug>.md` (memory-format.ts) | concept tree + encounters, newest first |
| Roadmap input | `RoadmapInput` (brain-contract.ts), built in learning/study/context.ts | `mastery[]` (flat), `encounters[]` (seen/bigPicture/understanding), `openQuestions[]`, `doneSteps`, `carry` |

What's missing: facts smaller than an encounter, summaries written from all the evidence (today a
summary is the first `seen` that arrived), "A before B" order, and per-item control in the UI.

## 2. Topic tree

- Keep `concepts` + `parent_id` as the tree; no new table. Level 1 under a subject is a **topic**
  (e.g. "Substitution reactions"), and deeper levels are concepts.
- `topicPath` keeps building the chain as now, through `upsertChain`.
- Consolidation may re-parent concepts and merge siblings.
- Depth is capped at 3 below the subject: the extractor gives up to 4 levels, and the subject level is dropped.
- A concept's `summary` becomes **owned by consolidation**: 1–3 sentences written from its notes.
  Until the first consolidation, it stays the first `seen`, as today.

## 3. Atomic notes

A **note** is one fact, definition, formula, example or claim, short enough to quiz on.

```
Note { id, subjectId, conceptId|null, encounterId|null, kind: 'fact'|'definition'|'formula'|
       'example'|'highlight'|'question', text (≤ 200 chars), source: SourceRef,
       status: 'active'|'merged'|'deleted', mergedInto|null, pinned: boolean, createdAt, updatedAt }
```

- **From extraction:** P1 items get a new field `notes: string[]` (1–5, each ≤ 25 words, stating
  content not interface, "X is Y" style). The P1 rules add: "notes are the facts a student should
  remember from this item; no duplicates of each other".
- **From highlights:** each highlighted passage becomes a `highlight` note on the episode's leaf
  concept, verbatim (cut at 200 characters). `keepHighlights` already guarantees the episode
  counts as learning.
- **From open questions:** encounter `openQuestions` stay on the encounter; consolidation may lift
  recurring ones into `question` notes.
- **Dedupe on write (local, free):** `noteKey` = `conceptKey`-style normalisation of the text.
  If an active note on the same concept has the same key, or a token Jaccard of at least 0.8, the
  new one is dropped and the old note's `updatedAt` is touched. Fuzzy duplicates are left for
  consolidation.
- **Pinned:** a student-edited note is `pinned`, and consolidation never rewrites or merges it.

## 4. Placement

1. Leaf concept from `topicPath`, as now (`upsertChain`). Name match by `conceptKey`, within the
   subject.
2. If the leaf is new **and** an existing concept in the subject has a similar name (token Jaccard
   ≥ 0.5, or one name contains the other), the case is marked `ambiguous`: the note is placed on
   the new leaf for now, and the pair goes into the next consolidation as a merge candidate.
   There is no extra LLM call on the write path.
3. Notes without a subject (the episode matched no subject) stay with `conceptId = null` and show
   in the Inbox with their encounter.

## 5. Consolidation pass

**When:** per subject, after 10 or more new or changed notes since its last run, or nightly (the
first idle after 03:00) for subjects with any change. Never during a study session on that
subject. A debounced job in a new `engine/learning/consolidate/` service, on the existing worker
budget.

**Model:** tier `reason` (flash). It's one call per subject, so the budget impact is small.

**Input (JSON):**
```json
{ "subject": {"id":"sub_1","name":"Chemistry","goal":"…"},
  "concepts": [{"id":"con_1","name":"SN1","parentId":"con_0","summary":"…","mastery":0.4,"status":"learning"}],
  "notes": [{"id":"not_1","conceptId":"con_1","kind":"fact","text":"Tertiary substrates favour SN1","pinned":false}],
  "mergeCandidates": [["con_7","con_9"]],
  "edges": [{"from":"con_0","to":"con_1"}] }
```
Size cap: 60 concepts and 300 notes, newest first. A bigger subject runs in chunks of one topic at a time.

**Output (JSON, validated with zod, then applied in one transaction):**
```json
{ "summaries": [{"conceptId":"con_1","summary":"1–3 sentences"}],
  "mergeConcepts": [{"from":"con_9","into":"con_7"}],
  "reparent": [{"conceptId":"con_4","parentId":"con_2"}],
  "mergeNotes": [{"from":"not_8","into":"not_3","text":"optional better wording"}],
  "dropNotes": [{"noteId":"not_5","reason":"UI text, not content"}],
  "edges": [{"from":"con_2","to":"con_4","why":"needs carbocation stability"}],
  "newTopics": [{"name":"Reaction mechanisms","children":["con_1","con_2"]}] }
```

**Prompt sketch:** "You keep a student's study notes tidy. Rewrite each concept's summary only
from its notes, in plain words. Merge concepts and notes that say the same thing. Put concepts
under the right topic. Add an edge A→B only when B can't be understood without A. Never invent
facts that aren't in the notes; never touch pinned notes; never delete a concept that has notes."

**Applying:** concept merges reuse `foldConcept` / `relink` (encounters, questions and notes move
to the survivor). Note merges set `status='merged'` and `mergedInto`. A dropped note becomes
`status='deleted'` (soft) and is purged after 30 days. Edges that would make a cycle are skipped.
Afterwards 'memory:changed' is emitted, so the memory file and UI refresh.

**Cost:** a subject with 40 concepts and 200 notes is about 9k input and 2k output tokens. With
about 3 active subjects that's 3 calls a day, well inside the €10 cap.

## 6. Prerequisite edges and the roadmap

- `concept_edges(from_id, to_id, why, source 'llm'|'user', created_at)`, both concepts in the same
  subject, no cycles (checked on insert by walking the graph).
- New `RoadmapInput` fields (old fields kept so P3 keeps working during the switch):
  ```
  tree:  [{ id, name, parentId, status, mastery, summary }]          // ≤ 40, around the goal
  edges: [{ from, to }]
  keyNotes: [{ conceptId, text }]                                      // ≤ 3 per concept, pinned/highlights first
  openQuestions: string[]                                              // unchanged
  ```
- **Order rule** (done in code before the call, given to P3 as `suggestedOrder`): take the goal's
  concepts and their prerequisite closure, topologically sort it, drop `mastered` concepts (mastery
  ≥ 0.85), and start at the first concept whose prerequisites are all `learning` or `mastered`.
  P3 may group or split steps but must keep the order. `finalizeRoadmap` checks it.
- `promptDraft` for a step can quote the concept's key notes ("you saw that…"), so the AI starts
  where the student is.

## 7. User control (subject page)

The Concepts view becomes a tree: topic ▸ concept, each with a status badge, its summary, and its
notes listed underneath with their source (page title, time).

| Action | Effect |
|---|---|
| Edit note | text changes, `pinned=true`, search reindexed |
| Delete note | `status='deleted'`; it leaves the memory file and future prompts at once |
| Edit concept (rename, move, summary) | rename checks `conceptKey` clashes, summary edit pins the summary |
| Delete concept | its notes are deleted, its encounters lose `concept_id`, its children move up to its parent, its edges and quiz questions' `concept_id` are cleared |
| Merge concepts | `foldConcept` (as today), notes and edges move to the survivor |
| Delete encounter | the encounter goes, its notes are deleted, and its episode text too if nothing else uses it |
| Delete subject | as shipped today (`subjects.remove`), plus notes and edges |

## 8. Data model changes

- **Migration v2** (append to `MIGRATIONS`, never edit v1):
  - `notes (seq PK, id UNIQUE, subject_id → subjects ON DELETE CASCADE, concept_id → concepts ON
    DELETE SET NULL, encounter_id TEXT, kind, text, note_key, source JSON, status, merged_into,
    pinned INT, created_at, updated_at)`, with indexes on `(concept_id, status)` and `(subject_id, updated_at)`.
  - `concept_edges (from_id → concepts ON DELETE CASCADE, to_id → concepts ON DELETE CASCADE,
    why, source, created_at, PRIMARY KEY (from_id, to_id))`.
  - `subjects.consolidated_at TEXT NULL`, `concepts.summary_pinned INT DEFAULT 0`.
- **Repos (contracts.ts):** `NoteRepo { add, list({conceptId|subjectId|encounterId}), update,
  remove, merge, keyExists }`, `EdgeRepo { list(subjectId), add, remove }`, plus
  `ConceptRepo.remove(id)` and `EncounterRepo.remove(id)`. Each repo has a SQLite version, an
  in-memory version and conformance tests, like the existing repos.
- **Search:** a new `SearchKind` 'note' (rowid = seq·5 + kind; `SEARCH_KINDS` grows, so the FTS
  index is rebuilt once in migration v2).
- **Memory file:** under each concept, its summary, then `- note text (source, date)` bullets.
  Encounters keep their section but are shortened to the last 20.
- **IPC:** `notes.update`, `notes.delete`, `concepts.update`, `concepts.delete`,
  `encounters.delete`, `subjects.tree` (tree + notes + edges for the page).

## 9. Phases (each a lane; files don't overlap within a phase)

**Phase 1: notes and tree** (sequential lanes A then B)
- A, store: `src/engine/store/schema-v2.ts`, `migrations.ts`, `repos/notes.ts`, `repos/edges.ts`,
  `sqlite-repos.ts`, `testing/memory-repos.ts`, `conformance/notes.ts`, `search-index.ts`,
  `contracts.ts`, `shared/domain.ts` (Note, ConceptEdge).
- B, write path: `brain/prompts/p01-extract.ts` (notes field), `brain-contract.ts`,
  `perception/extraction/apply.ts` (notes, highlight notes, dedupe, ambiguous pairs),
  `subjects/memory-format.ts`.

**Phase 2: consolidation and roadmap** (parallel lanes C and D after phase 1)
- C: `engine/learning/consolidate/*` (service, prompt `p13-consolidate.ts`, apply, scheduler hook in
  `main/real/compose-real.ts`).
- D: `brain-contract.ts` (RoadmapInput fields), `learning/study/context.ts` (tree, edges, key notes,
  suggestedOrder), `brain/prompts/p03-roadmap.ts`, `finalizeRoadmap` order check.

**Phase 3: UI** (parallel lanes E and F)
- E: `shared/ipc.ts`, `main/ipc/handlers.ts`, `main/fakes/*`, `renderer/lib/mock/*`, `renderer/lib/queries.ts`.
- F: `renderer/pages/subject/ConceptsView.tsx` (tree, notes, edit and delete), `SeenView.tsx`
  (delete encounter), `subject.css`.

## 10. Decisions (2026-10-24)

Ilari approved the defaults:

1. **Highlights are quiz material right away.** Each highlight is stored as a `highlight` note
   (verbatim) at once, so quizzes and reviews can use it without waiting for consolidation.
2. **Consolidation timing:** after about 10 new or changed notes, nightly, **and** when the student
   opens the subject (phase 2).
3. **Prerequisite edges are visible but read-only** in the UI for now (phase 3); only consolidation
   writes them.
4. **Loose notes.** Casual reading that matches no subject does not create a suggested subject. Its
   notes stay unfiled (`subjectId` and `conceptId` null), with their encounter in the Memory/Inbox
   view, until the student files them. A suggested subject is still created when there is real
   study evidence: an assignment or deadline on the page, an AI chat about the topic, or the same
   topic coming back (an earlier loose encounter with the same subject name).
5. **Language:** notes are written in the page's language.

Also decided the same day: active capture checks for screen changes every second
(`DEFAULT_SETTINGS.cadence.activeMs = 1000`).

## 11. Phase 1 as built

- Storage as in §8, with `notes.subject_id` nullable for loose notes; search rows renumbered to
  `seq * 8 + kind`. Search shows a matching note as its concept (snippet = the note) or, when
  unplaced, as its encounter, because the app's search groups don't have a note kind yet (phase 3).
- `ConceptRepo.remove` and `EncounterRepo.remove` (§8) come with the delete UI in phase 3.
- Merge candidates for ambiguous placements (§4 step 2) are not stored; consolidation (phase 2)
  finds them from concept names with the same rule.
- The memory file shows notes under their concept and unplaced notes under "Other notes";
  encounters keep the existing cap (100), not 20.
