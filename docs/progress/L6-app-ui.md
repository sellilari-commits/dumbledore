# L6 App UI — status

Updated: 2026-10-24T19:00:00+03:00 (local) · overview kept by the exams/screens/DESIGN agent

## Who owns what (after the 18:23 restart)

| Part                                             | Paths                                                             | Owner now                        | State                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| Design system                                    | `src/renderer/design-system/**`                                   | read-only (frozen)               | ✅ tokens, base, components, 10 tests · 2 bugs below      |
| App shell                                        | `src/renderer/surfaces/app/**`, `app.html`, `pages/PageFrame.tsx` | read-only (frozen)               | ✅ sidebar, ⌘K, ⌘N, ⌘E, shortcuts, routes                 |
| Data layer                                       | `src/renderer/lib/**` (+ `lib/mock`)                              | lib agent                        | ✅ web tsc clean at 18:58                                 |
| Home                                             | `pages/home/**`                                                   | home agent                       | 🚧 renders, screenshots of its own                        |
| Inbox                                            | `pages/inbox/**`                                                  | inbox agent                      | 🚧 renders, screenshots of its own                        |
| Subject (roadmap/concepts/seen/exams)            | `pages/subject/**`                                                | subject agent                    | 🚧                                                        |
| Settings (8 sections)                            | `pages/settings/**`                                               | settings agent                   | 🚧 all 8 sections render                                  |
| Onboarding                                       | `pages/onboarding/**`                                             | onboarding agent                 | 🚧                                                        |
| Mini panel + picker                              | `surfaces/panel/**`, `panel.html`                                 | panel agent                      | ⬜                                                        |
| Exams (list, New exam, writing, taking, results) | `pages/exams/**`                                                  | exams agent (this file's keeper) | ✅                                                        |
| Screenshot spec                                  | `tests/e2e-sim/ui-screens.spec.ts`                                | exams agent                      | ✅ 40/40 green at 19:00 · writes `route-*` + `ui-exams-*` |
| Design doc                                       | `docs/DESIGN.md`                                                  | exams agent                      | ✅                                                        |

## Exams — done

- List: Notion table (name · type · subjects · score · date), row → exam; loading skeleton, error +
  retry. Empty: one primary button — "New exam" (⌘E), or "New subject" (⌘N) when there are no
  subjects yet; the top-bar button hides while empty.
- New exam dialog: active subjects (focus subject or the ones it was opened with preselected),
  5/10/20, difficulty, focus (weak / due / everything), "About N min", → `exams.create` → exam page.
- Writing state: header with meta line + "Writing 10 questions on Organic Chemistry…" skeleton;
  re-reads the quiz every 3 s as a fallback to the `memory.changed` push.
- Taking: sticky "n of N answered" strip, instant feedback + rationale, keys 1–4 answer the next
  open question, Finish enabled when all answered → `quiz.finish` → results.
- Results: score + %, by-concept table, "Your gaps" grouped per concept — the engine's diagnosis
  in words, or "you picked “…”" when the diagnosis is the option — with Q links that open "Review
  your answers" at that question; repair prompt with Explore with ChatGPT (paste, never send;
  falls back to Copy) and Copy prompt; next topic; failed / scoring / error states.
- Tests: `pages/exams` 4 files, 22 tests + design-system 10 — green.

## Screens

`npx playwright test tests/e2e-sim/ui-screens.spec.ts` starts its own Vite preview (5180 or the
next free port), visits every route light + dark with `?mock=1&latency=0` (home, inbox, exams list,
exam results, subject ×4 views, settings ×8, onboarding) and writes full-length
`tests/e2e-sim/__screenshots__/route-<route>-<theme>.png` (34 files), plus the exam flow
(empty, New exam, writing, taking) as `ui-exams-<state>-<theme>.png` (8 files). A crash, the
not-found page or an uncaught error fails the test softly (the picture is still written).
`--grep 'route-'` / `--grep 'ui-exams-'` runs one part; `UI_SCREENS_DIR=<dir>` writes elsewhere.
40/40 green at 19:00.

- Screenshot owners: `route-*` and `ui-exams-*` = this spec; `ui-<page>-*` = each page lane's
  own spec (home, inbox, subject, settings, onboarding, panel). This spec never writes those.
- Run with `--output <scratch dir>`: Playwright wipes the shared `test-results/` at start, which
  broke parallel runs (seen at 18:52).
- Cleanup: the 18:52 run had written `ui-<page>-*` names; all were overwritten by the page lanes
  except `ui-onboarding-{light,dark}.png`, which I deleted (stale placeholder shots).

## Open issues / requests for the integrator

- Design-system bug: `QuizQuestion` wrong-answer feedback says "The answer is A." but the rows
  have no A–D labels — quote the option or say "the right answer is marked in green".
- Design-system bug: `Choices` selected chip in dark mode is `--c-bacPri` (#191919) on the
  `--c-bacTer` (#383836) track, so it looks sunken; needs a raised colour (≈ #4a4a48) + shadow.
- Token names for other lanes: core `--c-texPri/Sec/Ter/Dis`, `--c-bacPri/Sec/Ter/Int`, `--c-popBac`,
  `--c-borPri/Str`, `--c-icoPri/Sec`, `--c-accent*`, pairs `--c-<colour>-{text,bg,ink}`,
  `--shadow-{sm,md,lg,button,focus}`, `--radius-{control,menu,panel}`, `--dur-{fast,base}`, `--ease-out`.
- Contract gap: no `profile.get/update` channel → "About you" is a localStorage stub (`lib/profile.ts`).
- Contract gap: no export / delete-all channels for Settings → Data.
- Results are read through `quiz.finish` (no `quiz.result` channel); the engine's finish is
  idempotent for done quizzes, so this is safe.
- The mock's gap `misconception` is the picked option, the engine's is a sentence; the results
  page handles both.
