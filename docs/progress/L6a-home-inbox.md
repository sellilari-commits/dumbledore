# L6a Home + Inbox — status

Updated: 2026-10-24T19:05:00Z

## Scope

- ✅ Home (/home) — greeting + today line (reviews due · deadlines this week), Continue cards
  (k/n bar, hover "Resume" → session.start), Due for review (+ "Start 5-min review" →
  coach.runAction start_review), Struggling with (red callout, "Study this" → start_roadmap),
  Upcoming deadlines (orange ≤ 2 days, red overdue; inline "Add deadline" → assignments.add),
  This week (time, questions, accuracy, grey minute bars per subject), Prompting habits (+ tip
  for the weakest habit); first-day empty state, skeleton with specific copy, error + retry
- ✅ Inbox (/inbox) "What Dumbledore knows" — rows with source (icon, title, app · host · dwell,
  time) and Seen (quote) / Big picture (+ topic path) / Understanding (coloured tag + evidence);
  Keep / file under subject / Ignore / Restore (inbox.act, optimistic hide, rollback on error);
  suggested subjects Add / Merge into… / Dismiss (suggested.act); tabs New · Kept · Ignored · All
  and a subject filter (incl. Unfiled); capture line (status, new today, Pause/Resume); first-day,
  caught-up, filtered-empty, loading, error states
- ✅ Tests — `pages/home/HomePage.test.tsx`, `home-utils.test.ts`, `pages/inbox/InboxPage.test.tsx`,
  `inbox-utils.test.ts`: 28 green
- ✅ Screenshots — `tests/e2e-sim/ui-home-inbox.spec.ts` (8 tests green; own Vite server on 5182 or
  `PREVIEW_URL`): `ui-home-{light,dark}[-full].png`, `ui-inbox-{light,dark}[-full].png`,
  `ui-home-{empty,loading,add-deadline}-light.png`, `ui-inbox-{empty,error}-light.png` — reviewed

## Next

1. Integrator: wire Electron opening of a source URL if wanted (see below).

## Open issues / requests for the integrator

- `tests/e2e-sim/ui-screens.spec.ts` (exams lane) also writes `ui-home-<theme>.png` /
  `ui-inbox-<theme>.png`; whichever spec runs last wins. Suggest it skips /home and /inbox.
- Inbox source titles are not links: there is no IPC channel to open an external URL safely.
- Mock quirk: the `empty` scenario keeps demo prompt habits, so Home's first-day check ignores
  habits.
