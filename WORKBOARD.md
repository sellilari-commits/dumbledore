# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-25 07:00 | Ilari / Claude | Right ⌥ gestures: double-tap chat never pastes (+ adjust_roadmap action); long press = new subject → roadmap → first prompt | src/main/flows/ask-flow.ts (+ test), src/main/flows/prompt-writer.ts (+ test), src/main/flows/roadmap-adjust.ts (new), src/main/flows/coach-actions.ts, src/main/overlay/labels.ts, src/main/shell.ts (wiring only), src/engine/brain/prompts/p10-coach.ts (+ test), src/shared/domain.ts (CoachAction only), src/engine/scheduler/nudge-engine.ts (label map entry), src/renderer/surfaces/askbar/ | main | coordinator deploys |
| 2026-10-25 00:10 | Ilari / Claude | Notes phase 2: LLM consolidation per subject (summaries, merges, topic tree, prerequisite edges), triggers, structured roadmap input; + fix: coding-agent chats/highlights not notes | src/engine/learning/consolidate/ (new), src/engine/brain/prompts/p13-consolidate.ts (new), p00-triage.ts, p03-roadmap.ts, src/engine/brain-contract.ts, src/engine/brain/brain.ts (+ brain tests), src/engine/testing/fake-brain.ts, src/engine/learning/study/ (roadmap context), src/engine/events.ts, src/engine/perception/episodes/open-episode.ts, src/engine/perception/extraction/worker.ts (+ tests); minimal, agreed with coordinator: src/main/real/compose-real.ts (wire consolidation), src/main/ipc/handlers.ts (subject:viewed emit, pushed); small additive only: src/engine/contracts.ts, src/shared/domain.ts | main | |
| 2026-10-24 22:50 | Ilari / Claude | Notes phase 3: memory control (subject tree with notes, edit/delete note/concept/encounter, loose notes filing) | src/shared/ipc.ts, src/shared/state.ts, src/engine/contracts.ts (ConceptRepo/EncounterRepo.remove, MemoryService), src/engine/store/repos/{concepts,encounters,notes}.ts, src/engine/store/conformance/, src/engine/testing/memory-repos.ts, src/engine/subjects/ (memory-service), src/main/ipc/ (handlers, ipc.test), src/main/fakes/, src/main/real/compose-real.ts (wire service), src/renderer/lib/mock/, src/renderer/lib/mock-api.ts, src/renderer/lib/live.ts (scope map), src/renderer/lib/memory-queries.ts (new), src/renderer/lib/queries.ts (invalidation entries only), src/renderer/pages/subject/, src/renderer/pages/inbox/, tests/e2e-sim/ subject+inbox specs and their screenshots | main | coordinator deploys; backend 53f2adc pushed, UI next |
| 2026-10-24 22:20 | Olle / Claude | Empty home first steps; onboarding intro; white backgrounds + popovers above dialogs; one-page subject (description, goals, progress, gaps, what Dumbledore caught) | `src/renderer/pages/home/`, `src/renderer/pages/onboarding/`, `src/renderer/pages/subject/`, `src/renderer/design-system/tokens.css`, `docs/DESIGN.md`, `tests/e2e-sim/` | main | Renderer only; routes kept (/subjects/:id/:view all show the one page) |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
| 2026-10-25 | Ilari / Claude | Batched extraction: 5-min windows, P0 triage judged together, P1 only for yes with window context; prefilter as pre-gate | dd9f8a1 |
| 2026-10-25 | Ilari / Claude | Mini panel: only the topics of one subject (focus, else latest new info), calm and simple | c6aeffd |
| 2026-10-25 | Ilari / Claude | Only the orb on the right: Study pill removed | 1bfd3ea |
| 2026-10-24 | Ilari / Claude | Notes phase 1: notes + concept edges storage, LLM-placed notes with keywords, highlight and loose notes; capture every 1 s | 32065e8, 0b11e71, f96a20c |
| 2026-10-24 | Olle / Claude | Ink & parchment look: ink accents, parchment backgrounds, line icons instead of interface emojis, Inbox → Memory | a16eb45 |
| 2026-10-24 | Ilari / Claude | Orb click only opens/closes the panel, never writes a prompt | dea0004 |
| 2026-10-24 | Ilari / Claude | No "📝 Noted" box when a highlight is caught | a0300f6 |
| 2026-10-24 | Ilari / Claude | Removed the ▸ Next square under the orb (no squares left) | 7e61d26 |
| 2026-10-24 | Ilari / Claude | Design doc: structured notes for the roadmap (docs/NOTES.md) | f4cab28 |
| 2026-10-24 | Ilari / Claude | Removed the Quiz square under the orb (▸ Next stays) | 0bb8c08 |
| 2026-10-24 | Ilari / Claude | Region trimming: keep a page's main content, drop nav/sidebars/header/footer (AX landmarks) | b59a293 |
| 2026-10-24 | Olle / Claude | Back to logo D as built: reverted the D2 mark and the light-touch accents (Olle's call) | 738de89 |
| 2026-10-24 | Ilari / Claude | Extractor judges learnable content, not intent; news neutral in prefilter | 2dc50a7 |
| 2026-10-24 | Olle / Claude | Friendlier mark (D2) and light-touch accents: ink buttons, midnight rings/progress, warm panel, mark in empty states | 57915fe |
| 2026-10-24 | Ilari / Claude | Highlight text → note in memory; store only new lines per page (dedupe) | 7f7cf7b, c2f71b7 |
| 2026-10-24 | Olle / Claude | Logo D (spectacles and beard): orb, tray, app icon, favicon; `npm run icons` | 2641a58 |
| 2026-10-24 | Ilari / Claude | Delete a subject: trash button in the sidebar and on the subject page, forgets everything about it | 57a2609 |
| 2026-10-24 | Ilari / Claude | Fresh install starts empty: orb and chat window never fall back to demo data | 84f8871 |
| 2026-10-24 | Ilari / Claude | Workboard rules for every agent (AGENTS.md + pointers) and the pre-push hook | see log |
| 2026-10-24 | Ilari / Claude | Double-tap chat: recent topics carousel on top | c13beea |
| 2026-10-24 | Ilari / Claude | Capture stays on while the screen changes, even without input | 250e04b |
| 2026-10-24 | Ilari / Claude | No tip box after a prompt is pasted | ac41cbe |
| 2026-10-24 | Ilari / Claude | Long press: describe what you want, Dumbledore writes the prompt | 244adae |
| 2026-10-24 | Ilari / Claude | Memory on real use: no demo leaks, steadier capture, better extraction | e657135 |
