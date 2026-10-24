# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-25 12:15 | Olle / Claude | Outline: on a PDF/article, Dumbledore marks what to read for the student's gaps (read / skim / skip) and saves it to the subject. Self-contained parts first; wiring into brain.ts, shell.ts, shortcut-router.ts, perception/service.ts and overlay/controller.ts waits for those claims to close | `src/engine/brain/prompts/p15-outline.ts` (new, + test), `src/engine/brain-contract.ts` (OutlineInput/Output, additive), `src/engine/testing/fake-brain.ts` (outline), `src/main/flows/outline-flow.ts` (new, + test), `src/main/router/decide.ts` (+ test, outline decision), `src/shared/state.ts` (OverlayState.outline, additive), `src/renderer/surfaces/overlay/outline/` (new), `src/renderer/surfaces/overlay/OverlayApp.tsx` (render marks), overlay mock scenes + `tests/e2e-sim/overlay-screens.spec.ts`, `src/main/router/shortcut-router.ts` (outline dep + cases), `src/main/overlay/controller.ts` (setOutline, clear on window change), `native/helper` Perceive/Protocol + `src/shared/helper-protocol.ts` (perceive `fresh`), helper client/fake tests; also `src/renderer/pages/PageFrame.tsx` (back/forward buttons, alongside Ilari's format-only claim) | main | Built and tested; only brain.ts (outline method) and shell.ts (construct OutlineFlow) left, after the feedback row |
| 2026-10-25 12:00 | Ilari / Claude | Double-tap chat: typed notes (note: …, Undo) and feedback to the system (stored, fed into prompts) | src/shared/domain.ts (CoachAction add_note/undo_note/give_feedback, FeedbackScope), src/engine/contracts.ts (FeedbackRepo, additive), src/engine/store/ (schema-v4 feedback, migrations, repos/feedback.ts, sqlite-repos), src/engine/testing/memory-repos.ts, src/engine/brain/brain.ts + prompts/shared.ts (feedback injection) + p10-coach.ts, src/main/flows/ask-flow.ts, coach-actions.ts, typed-notes.ts (new), src/main/overlay/labels.ts, src/main/shell.ts + real/compose-real.ts (wiring), src/renderer/surfaces/askbar/AskBar.tsx + ActionChips.tsx + askbar unit tests; copy-only: "Open a topic" (long press) and "Tell Dumbledore how to do its work" (chat) in AskBar.tsx, prompt-writer doc/test, and the copy/selector lines of tests/e2e-sim/askbar-chat.spec.ts (+ askbar-chat/compact screenshots), coordinated with the resize row | main | additive edits to domain/contracts |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
| 2026-10-25 | Ilari / Claude | "Waiting for the answer" box on an early tap | 39192ae |
| 2026-10-25 | Ilari / Claude | Panel: a topic opens its detail (roadmap steps with states, flags with ✕, lock) | 70ce9f9 |
| 2026-10-25 | Ilari / Claude | Double-tap chat resizable by its edges; size and place remembered across restarts | 2cb66cd, 09b901b |
| 2026-10-25 | Ilari / Claude | Roadmap step done only once the AI's answer is in the chat; helper selftest expects file.pdfText | c2961c6, 664edaa, 278d4c2 |
| 2026-10-25 | Ilari / Claude | QA sweep: quiz smoke test, lint leftovers, ask bar mock; SECRETS: redactor catches prefixed names, secret-file windows never read, highlights masked, stored secrets scrubbed at start | 3f999d4, 151929b, 45ad540, 96a79bc |
| 2026-10-25 | Ilari / Claude | Checkpoint asks "Do you want to have a quiz or continue?" (Quiz / Continue) | 624b8a8 |
| 2026-10-25 | Olle / Claude | Exams name a topic per question (P6 v2), so answers reach mastery and gaps; subject page shows exam results, strengths and Test me | see log |
| 2026-10-25 | Olle / Claude | Study material upload: PDF (PDFKit in the helper), Word/RTF/HTML (textutil), text and Markdown → extraction into the subject | see log |
| 2026-10-25 | Olle / Claude | Errors in plain words; AI timeouts point to Settings → AI providers (renderer/lib/errors.ts, invoke wrapper, app pages) | see log |
| 2026-10-25 | Olle / Claude | One-page subject: description, goals, progress, gaps, What Dumbledore caught (Ilari's topic tree + captures by day) | see log |
| 2026-10-25 | Ilari / Claude | Timer square: white progress edge around the running square | 6d55186 |
| 2026-10-25 | Ilari / Claude | Chat box can be moved by its header; position remembered per display | 5411676, build fix 7eba6d5 |
| 2026-10-25 | Ilari / Claude | Double-tap (or orb long press) closes the open chat | e317da2 |
| 2026-10-25 | Ilari / Claude | No pop-up boxes except the selection menu and the /d reply; timer notification stays | 6364d96 |
| 2026-10-25 | Ilari / Claude | Timer: change the time while it runs (−5/−1/+1/+5, Stop) | 52edb77 |
| 2026-10-25 | Ilari / Claude | Orb can sit anywhere on the edge again (Wispr band removed) | 45ce959 |
| 2026-10-25 | Ilari / Claude | Double-tap chat: fixed 380 × 520 box beside the orb, "Chat with Dumbledore" header; study box stays compact | 77706c0 |
| 2026-10-25 | Ilari / Claude | Timer length: chooser on the timer square (5/15/25/45/60/custom), remembered; Settings → Orb | bb763cc |
| 2026-10-25 | Ilari / Claude | Orb keeps clear of Wispr Flow's bar (reserved middle of the right edge) | 49e7e64 |
| 2026-10-25 | Ilari / Claude | adjust_roadmap: chat wishes become study preferences on the topic tree (P14, schema v3), roadmap order follows them | 7380aca |
| 2026-10-25 | Ilari / Claude | Fast memory: page → subject/topic in the panel in ~18 s (early checkpoint, 5 s debounce, subjects active, no auto roadmaps) | d6cde58 |
| 2026-10-25 | Ilari / Claude | No hover text on the orb | 9c66d0c |
| 2026-10-25 | Ilari / Claude | Timer square under the orb: 25 min, macOS notification when done | 3099c8f |
| 2026-10-25 | Ilari / Claude | Notes phase 2: LLM consolidation per subject, triggers, roadmap follows the study order; summaryPinned; coding-agent highlights not notes | c9f3f72, d17c73e, e2e7337, d9f1384, 5e544b3 |
| 2026-10-25 | Ilari / Claude | Capture settings: "Every second" option | 95ce206 |
| 2026-10-25 | Ilari / Claude | Mini panel v2: topic names only, Lock topic toggle (else follow latest), window fits its list, live refresh; tap studies the current topic | 8991fde |
| 2026-10-25 | Ilari / Claude | Right ⌥: double-tap chat never pastes (+ adjust_roadmap); long press = new subject → roadmap → first prompt | 6142b26 |
| 2026-10-25 | Ilari / Claude | Notes phase 3: memory control IPC/service (tree, notes edit/delete/file, concept and encounter delete) + Memory page loose notes; subject-page tree handed to Olle as docs/progress/notes-phase3-subject-tree.patch | 53f2adc, bbc3066 |
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
