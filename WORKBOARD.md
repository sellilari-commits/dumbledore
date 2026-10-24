# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-24 20:11 | Olle / Claude | Friendlier logo (D2) and light-touch brand accents: ink primary buttons, midnight rings/progress/selection, warm panel, mark in empty states | `src/shared/brand-mark.ts`, `src/main/tray.test.ts`, `tools/brand/`, `resources/icon.*`, `resources/brand/`, `src/renderer/design-system/tokens.css`, `src/renderer/design-system/components/{SpectaclesGlyph,Feedback}.tsx`, `src/renderer/surfaces/panel/panel.css` (card background only), `docs/DESIGN.md` (tokens) | main | Orb picks up the new mark and ring colour via brand-mark.ts and tokens.css; no edits in Ilari's claimed overlay/ folder |
| 2026-10-24 20:11 | Ilari / Claude | Highlight text → note in memory | src/engine/perception/ (highlights.ts, service.ts, episodes/, extraction/prefilter.ts), src/shared/domain.ts, src/shared/ipc.ts, src/engine/events.ts, src/engine/store/codec.ts, src/engine/brain/prompts/p01-extract.ts, src/main/ (broadcaster wiring), src/renderer/surfaces/overlay/ | main | |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
| 2026-10-24 | Olle / Claude | Logo D (spectacles and beard): orb, tray, app icon, favicon; `npm run icons` | 2641a58 |
| 2026-10-24 | Ilari / Claude | Delete a subject: trash button in the sidebar and on the subject page, forgets everything about it | 57a2609 |
| 2026-10-24 | Ilari / Claude | Fresh install starts empty: orb and chat window never fall back to demo data | 84f8871 |
| 2026-10-24 | Ilari / Claude | Workboard rules for every agent (AGENTS.md + pointers) and the pre-push hook | see log |
| 2026-10-24 | Ilari / Claude | Double-tap chat: recent topics carousel on top | c13beea |
| 2026-10-24 | Ilari / Claude | Capture stays on while the screen changes, even without input | 250e04b |
| 2026-10-24 | Ilari / Claude | No tip box after a prompt is pasted | ac41cbe |
| 2026-10-24 | Ilari / Claude | Long press: describe what you want, Dumbledore writes the prompt | 244adae |
| 2026-10-24 | Ilari / Claude | Memory on real use: no demo leaks, steadier capture, better extraction | e657135 |
