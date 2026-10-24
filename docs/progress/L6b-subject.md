# L6b Subject page — status
Updated: 2026-10-24T19:00:00+03:00 (local) · lane done

## Scope
- ✅ `pages/subject/SubjectPage.tsx` — the 0611793 draft was only a placeholder; now the full page
  (route `/subjects/:id/:view`, unknown view → redirect to roadmap)
- ✅ Header: emoji picker (Popover grid), inline title (click-to-edit, Enter/blur saves, Esc
  cancels → `subjects.update`), properties Deadline (date popover) · Goal (inline) · Status
  (Learning/Mastered/New + "n reviews due" + "n struggling") · Progress (roadmap bar, "2 of 8 steps")
  · This week · Next due (assignment); suggested subjects get a keep/dismiss callout (`suggested.act`)
- ✅ Top bar: Focus toggle (subject.focus + global focus via `coach.runAction set_focus`), Generate
  exam (shared New exam dialog, subject preselected; hidden for non-active subjects)
- ✅ Roadmap: RoadmapItem to-dos, expand → prompt with Copy (`prompt.copy`) / Send to chat
  (`prompt.sendToChat`, reason toast + "Copy instead" when no chat), checkpoints as callouts with
  carried ideas; header "Step 3 of 8 · about 48 min", 🧭 why-this-order callout, next milestone;
  empty state → `coach.runAction start_roadmap`
- ✅ Concepts: DatabaseTable (name, status + Due, mastery bar in status colour, last seen, next
  review) with a Notion "Sort" menu in the tab bar (default: mastery ↑, nulls last)
- ✅ Seen: encounters grouped by day; source line + Seen / Big picture / Understanding / Open questions
- ✅ Exams: this subject's exams table, row → exam, New exam (ghost in tab bar, primary in empty state)
- ✅ Loading (header-shaped skeleton + view-specific caption), error + retry, empty states
- ✅ Tests: `SubjectPage.test.tsx` (21) + `subject-utils.test.ts` (6) — 27 green
- ✅ Screenshots light + dark → `tests/e2e-sim/__screenshots__/ui-subject-*.png` (28, reviewed)
- ✅ Checks: `tsc -p tsconfig.web.json` 0 errors · `biome check src/renderer/pages/subject` clean ·
  `vitest run src/renderer/pages/subject` 27/27

## Next
1. Nothing required. Nice-to-have: per-subject Mute (focus 'muted'), click-to-caret title editing.

## Open issues / requests for the integrator
- PageHeader wraps `icon` in `aria-hidden`, so an interactive icon can't go there; the page renders
  its own icon button above PageHeader (CSS override `.sp-header .dd-page-header { padding-top: 0 }`).
  Request: an `onIconClick`/`iconLabel` prop (or no aria-hidden when the icon is a control).
- DatabaseTable has no sortable headers; the sort lives in a Menu in the ViewTabs `right` slot.
- `useAction('coach.runAction')` doesn't invalidate `subjects.get`; the page invalidates it itself
  after start_roadmap (push events cover it too).
- Screenshot script lives outside the repo (agents share a scratchpad); fold the subject routes into
  `tests/e2e-sim/ui-screens.spec.ts` if wanted: roadmap, roadmap-step, concepts, concepts-sort,
  seen, exams, emoji, linalg, suggested-empty, empty-exams, loading (`scenario=slow`), error.
