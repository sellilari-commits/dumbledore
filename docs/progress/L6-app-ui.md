# L6 App UI — status
Updated: 2026-10-24T18:02:00Z

## Scope
- ✅ `design-system/tokens.css` (PLAN §3.2 tokens, light/dark, type, spacing, radii, shadows, motion) + `base.css`
- ✅ Design-system components (§5.5) in `design-system/components/*` + barrel `design-system/index.ts`
  (Button/IconButton, Input/Textarea/Field, Switch, Checkbox, RadioGroup/RadioRow, Choices, Kbd, Tag,
  ProgressBar, Callout, ToggleBlock, Divider/Skeleton/LoadingState/EmptyState/ErrorState, Spinner,
  Tooltip, Menu, Dialog, Popover, Toast, CommandPalette, DatabaseTable, ViewTabs, Sidebar*, TopBar/
  Breadcrumbs, Page/PageHeader/Property/Section, QuizQuestion, RoadmapItem, SpectaclesGlyph)
- ✅ Data layer `lib/`: api.ts (real vs mock), queries.ts (hooks + useAction), live.ts (events →
  cache), chat.ts (streamed chat), mock-api.ts + mock/* (whole DumbledoreApi, demo data, scenarios
  demo/empty/onboarding/slow/error), format, status, theme, hotkeys, shell store, providers,
  profile (About-you stub), test-utils
- ✅ App shell: app.html, surfaces/app (App, sidebar, ⌘K, ⌘N dialog, shortcuts), pages/PageFrame
- 🚧 Pages: Home, Subject, Inbox (me) · Exams (fork B) · Settings + Onboarding (fork A)
- ⬜ Mini panel + Picker (panel.html)
- 🚧 Tests: design-system tests green (10)
- 🚧 Vite preview: `npx vite --config src/renderer/surfaces/app/vite.preview.config.mjs` (port 5180)
- ⬜ Playwright screenshot spec `tests/e2e-sim/ui-screens.spec.ts`, light/dark, reviewed
- ⬜ docs/DESIGN.md

## Next
1. Home, Subject, Inbox pages; panel + picker.
2. Screenshot spec + review + polish; DESIGN.md.

## Open issues / requests for the integrator
- Token names for other lanes: core `--c-texPri/Sec/Ter/Dis`, `--c-bacPri/Sec/Ter/Int`, `--c-popBac`,
  `--c-borPri/Str`, `--c-icoPri/Sec`, `--c-accent*`, pairs `--c-<colour>-{text,bg,ink}`,
  `--shadow-{sm,md,lg,button,focus}`, `--radius-{control,menu,panel}`, `--dur-{fast,base}`, `--ease-out`.
- Contract gap: no `profile.get/update` channel → "About you" is a localStorage stub (`lib/profile.ts`).
- Contract gap: no export / delete-all channels for Settings → Data.
