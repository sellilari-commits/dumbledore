# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-24 21:55 | Ilari / Claude | No notification boxes beside the orb (toasts off; nudges go straight to the orb dot) | src/main/overlay/controller.ts (+ controller.test.ts) | main | |
| 2026-10-24 21:50 | Ilari / Claude | Notes phase 1 (docs/NOTES.md): notes + concept_edges storage, extractor notes, highlight/loose notes, dedupe | docs/NOTES.md, src/shared/domain.ts, src/engine/contracts.ts, src/engine/store/ (schema-v2, migrations, repos/notes.ts, repos/edges.ts, repos/subjects.ts, sqlite-repos, search-index, conformance/), src/engine/testing/memory-repos.ts, src/engine/brain-contract.ts, src/engine/brain/prompts/p01-extract.ts (+ brain parse/fixtures), src/engine/perception/extraction/apply.ts, src/engine/subjects/memory-format.ts, src/engine/subjects/subject-service.ts, src/engine/store/repos/concepts.ts + concept-rows.ts, src/main/data/ (export, wipe); also capture cadence default (src/engine/perception/cadence.ts, scheduler.test.ts) | main | no deploy (coordinator deploys after) |
| 2026-10-24 21:05 | Olle / Claude | Ink & paper look: ink accents, parchment backgrounds, ink line icons instead of interface emojis, Inbox → Memory | `src/renderer/design-system/` (tokens.css, base.css, Callout/EmptyState), `src/renderer/pages/` (icons and wording only), `src/renderer/surfaces/app/`, `src/renderer/surfaces/panel/`, `src/renderer/surfaces/askbar/askbar.css`, `src/renderer/surfaces/overlay/` (toast, quiz result, suggestion chip icons only), `docs/DESIGN.md`, `tests/e2e-sim/` | main | Visual and wording only; routes, data and behaviour unchanged |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
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
