# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-25 14:40 | Olle / Claude | Overnight QA: fresh install works from a clean clone (helper builds on the macOS 15 SDK, npm ci fetches Electron, one install-app script, README), repo-wide lint clean, then fixes in unclaimed areas from a full audit | `native/helper/Sources/DumbledoreHelper/{OnDevice,JSONSchema,SelfTest}.swift`, `native/helper/build.sh`, `package.json` (allowScripts, scripts), `tools/install-app.sh` (new), `README.md` (new), `biome.json` (lint scope), `resources/brand/*.svg` + `tools/brand/build-icons.ts` + `src/shared/brand-mark.ts` (svg title), `docs/progress/QA-overnight.md` (new); OCR (`native/helper/.../OCR.swift`, `tests/integration/helper-ocr.test.ts`); surfaces audit fixes: `src/main/router/{decide,shortcut-router,hints}.ts` (+ tests), `src/main/chat/chat-writer.ts` (toast purpose), `src/main/overlay/{toasts,controller}.ts`, `src/main/flows/outline-flow.ts`, `src/main/app.ts` (chord source, quiz keys, tray), `src/main/tray.ts` (+ test), `src/main/ipc/{events,broadcast}.ts` (+ ipc.test, settings broadcast), learning-loop fixes: `src/main/flows/app-state.ts`, `src/main/shell.ts` (usual AI in AppState), `src/main/ipc/handlers.ts` (app.getState), `src/main/real/compose-real.ts` (assistant name), `src/engine/perception/extraction/prefilter.ts`, `src/engine/queries/home.ts`, `src/engine/learning/study/deps.ts`, `src/engine/learning/quiz/quiz-service.ts` (+ their tests), `src/renderer/pages/home/FirstSteps.tsx`, `src/renderer/pages/onboarding/{DoneStep,KeyStep}.tsx`, `src/renderer/surfaces/overlay/quiz/ResultView.tsx`, `src/renderer/surfaces/overlay/` (OverlayApp, outline, styles/base.css, main.tsx theme) | main | Nothing in Ilari's claimed files; findings there go to the QA report. Pushed: fresh install fixes; surfaces batch; learning-loop batch |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
| 2026-10-25 | Ilari / Claude | Memory page: each topic ends with "All extracted text", a text file of everything captured about it (screen text by source, extracted records, notes) | b65129c |
| 2026-10-25 | Ilari / Claude | Double-tap chat takes no notes: Note toggle, "note:" saving and note Undo removed; hint "Ask anything or give feedback on your study plan." (stored notes, Memory page, highlight notes untouched) | 95d67ed |
| 2026-10-25 | Ilari / Claude | Memory cleanup, cut down to ingestion (no second cleaning pass, episode text kept): highlight fragments trimmed/dropped at capture, P1 leaves out glued page controls; topics unite their sources (P13 v2 unite + big picture, ~30 s after a new page, moves a concept to another subject), sources in subjects.tree and the roadmap input | f59f222, c20d040 |
| 2026-10-25 | Olle / Claude | Outline: right ⌥ on a page being read marks what to read for the subject's gaps (highlighter + reading order + spotlight), follows the scroll, saves passages to the subject | see log (eb4f458…) |
| 2026-10-25 | Olle / Claude | Usual AI (named the same everywhere, opened to explore) + gap prompts (reopened results ask P7 again; better template) | see log |
| 2026-10-25 | Ilari / Claude | Memory page as "what you know": By topic (big picture editable in place, sources linked, notes under each) / Recent timeline, loose notes with File to…, search; no Keep/Ignore, no Memory badge | 3467a65, 7ee6d7f |
| 2026-10-25 | Ilari / Claude | Double-tap chat: typed notes, Note toggle, feedback to the system; "Open a topic" / "Tell Dumbledore how to do its work" | 683dc50, 2379efa |
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
