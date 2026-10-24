# DS Design-system fixes — status
Updated: 2026-10-24T19:17:00+03:00 · lane done

## Scope
- ✅ `QuizQuestion`: feedback said "The answer is A." but rows had no letters. Letters don't fit:
  answer keys are 1–4 (exam key hints, overlay quiz card) and Notion's choice rows carry none. A miss
  now quotes the right option — Not quite. The answer is “2 and 5”. This one comes back in your next
  review. (The option's own final full stop is dropped; no option → just the last sentence.)
  ExamTaking, ExamResults review and the exam tests are unchanged.
- ✅ `Choices` dark mode: the selected chip was `--c-bacPri` (#191919) on a #383836 track, so it looked
  pressed in. New token `--c-choiceSelected` (light #ffffff = unchanged, dark #4a4a48).
- ✅ `PageHeader`: new `onIconClick` + `iconLabel` (default "Change icon") render the icon as a labelled
  button with hover/pressed states; `iconRef` and `iconExpanded` (aria-expanded) let a popover anchor
  to it. Without `onIconClick` the icon stays decorative (aria-hidden), as before.
- ✅ `Popover`: new `anchor` (ref) as an alternative to `trigger` (now optional): positions on that
  element, ignores clicks on it as "outside" (its own click toggles), gives focus back to it on close
  unless the user clicked or tabbed elsewhere.
- ✅ Subject page: header uses `PageHeader icon … onIconClick iconRef iconExpanded`; `EmojiPicker` is an
  anchored popover (`anchor`, `open`, `onOpenChange`). Removed the workaround (icon button above the
  header, `.sp-header` padding override, `.sp-icon`, `.sp-skel-icon`); the skeleton passes its icon to
  PageHeader too. Verified live on :5186: opens under the icon, toggles closed, Esc returns focus.
- ✅ Screenshot review (route-*, ui-*): one more DS-level dark bug — secondary/danger buttons and boxed
  keycaps were filled with `--c-bacPri`, so inside callouts and dialogs they read as dark wells
  ("Use right ⌘ instead" on Settings → Shortcuts, "Copy prompt" on exam results). New token
  `--c-buttonBg` (light #ffffff = unchanged, dark transparent).
- ✅ Biome-clean `design-system/`: `biome check --write` formatted 18 files (mostly older drift);
  `indexOf` in RadioRow; reordered two CSS rules (descending specificity); reasoned `biome-ignore`s
  for the custom radio/checkbox buttons, Notion property-list divs and the toast hover pause.
- ✅ Tests: 5 new in `design-system/__tests__/components.test.tsx` (quiz note, PageHeader icon both ways,
  anchored Popover toggle + focus return with user-event). `vitest run design-system exams subject`
  64/64 · `tsc -p tsconfig.web.json` 0 errors · `biome check design-system pages/subject` clean.
- ✅ Screenshots regenerated (light + dark): `ui-exams-*`, `route-subject-*`, `route-exams-results`,
  `route-settings-shortcuts` (the last one captures the settings lane's code as of 19:14).

## Next
1. Nothing required.

## Open issues / requests for the integrator
- `Menu` marks checked items with `aria-label="selected"` on a span and the sidebar badge with
  `aria-label="6 new"`; screen readers may ignore both (Biome a11y lint, now ignored with a reason).
  Proper fix = `menuitemradio` items / visually hidden text, but that renames items other lanes'
  tests query by exact name — do it together with those tests.
- `Choices` has no arrow-key roving focus (RadioGroup does); fine for 2–4 chips, worth adding later.
- Dark secondary-button hover is `--c-bacInt` (#262626), barely visible on a dialog (#252525);
  consider `--c-hover` there.
