# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-25 06:00 | Ilari / Claude | Only the orb on the right: remove the Study pill | src/renderer/surfaces/overlay/OverlayApp.tsx (+ test), satellites/StudyPill.tsx (deleted), tests/e2e-sim/overlay-screens.spec.ts (pill line) | main | |
| 2026-10-24 22:50 | Ilari / Claude | Notes phase 3: memory control (subject tree with notes, edit/delete note/concept/encounter, loose notes filing) | src/shared/ipc.ts, src/shared/state.ts, src/engine/contracts.ts (ConceptRepo/EncounterRepo.remove, MemoryService), src/engine/store/repos/{concepts,encounters,notes}.ts, src/engine/store/conformance/, src/engine/testing/memory-repos.ts, src/engine/subjects/ (memory-service), src/main/ipc/ (handlers, ipc.test), src/main/fakes/, src/main/real/compose-real.ts (wire service), src/renderer/lib/mock/, src/renderer/lib/memory-queries.ts (new), src/renderer/lib/queries.ts (invalidation entries only), src/renderer/pages/subject/, src/renderer/pages/inbox/, tests/e2e-sim/ subject+inbox specs and their screenshots | main | coordinator deploys |
| 2026-10-24 22:40 | Ilari / Claude | Batched extraction: ~5 min windows, cheap triage yes/no (P0) together, full P1 only for yes, prefilter as pre-gate | src/engine/perception/extraction/ (worker, prefilter, budget + tests), src/engine/brain-contract.ts, src/engine/brain/brain.ts, src/engine/brain/prompts/p00-triage.ts (new) + p01-extract.ts (context line), src/engine/brain/*.test.ts, src/engine/testing/fake-brain.ts | main | coordinator deploys |
| 2026-10-24 22:30 | Ilari / Claude | Mini panel: only the topics of the current subject (focus, else latest new info), calm and simple | `src/renderer/surfaces/panel/`, panel queries in `src/renderer/lib/` (if any), `tests/e2e-sim/ui-panel.spec.ts` + its panel screenshots | main | coordinator deploys |
| 2026-10-24 22:20 | Olle / Claude | Empty home: first-steps checklist; onboarding: "How Dumbledore works" intro step | `src/renderer/pages/home/`, `src/renderer/pages/onboarding/`, `tests/e2e-sim/` (home/onboarding specs + screenshots) | main | Renderer only; no data or engine changes |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
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
