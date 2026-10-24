# Dumbledore design system — as built

Notion's look (PLAN §3.2, §5.5): white space, one font, grey hierarchy, colour only for meaning.
Code: `src/renderer/design-system/` (tokens, base, components, styles). Screens:
`npx playwright test tests/e2e-sim/ui-screens.spec.ts` → `tests/e2e-sim/__screenshots__/route-*.png`
(every route, light and dark) and `ui-exams-*.png`; page lanes keep their own `ui-<page>-*.png`.

## Setup

- Each surface entry imports `design-system/tokens.css` then `design-system/base.css` once.
  Everything else comes from the barrel: `import { Button, Tag, … } from '@renderer/design-system'`.
- Components only use tokens (`var(--c-…)`), never raw hex. Page CSS does the same.
- Theme: no attribute = follow the system; `<html data-theme="light|dark">` forces one
  (`lib/theme.ts`, Settings → General, ⌘⇧L). `?theme=dark` in the URL wins (screenshots).
- Page CSS uses a short per-page prefix (`ex-` exams, `dd-set__` settings, `dd-onb__` onboarding);
  `dd-` without a page word belongs to the design system — don't restyle it from a page.

## Tokens

**Colour — core** (light / dark in `tokens.css`)

| Token                       | Use                                                                   |
| --------------------------- | --------------------------------------------------------------------- |
| `--c-texPri` / `--c-texSec` | body text / secondary text, subtitles, table meta (AA in both themes) |
| `--c-texTer`, `--c-texDis`  | placeholders, decoration, disabled — never meaningful text            |
| `--c-bacPri`                | page; blocks inside a callout (e.g. the prompt box)                   |
| `--c-bacSec`                | sidebar, callouts, prompt boxes                                       |
| `--c-bacTer`                | chips, pressed, segmented-control track                               |
| `--c-hover` / `--c-pressed` | translucent hover/pressed over any background                         |
| `--c-popBac`                | menus, popovers, dialogs                                              |
| `--c-borPri` / `--c-borStr` | dividers and table grid / input borders                               |
| `--c-icoPri` / `--c-icoSec` | icons; UI icons are Lucide at 1.5–1.75 stroke in `--c-icoSec`         |
| `--c-accent*`, `--c-link`   | primary buttons, links, focus, selection — the only blue              |

**Colour pairs** `--c-<colour>-{text,bg,ink}` for gray, brown, orange, yellow, green, blue, purple,
pink, red (`ink` = AA text on `bg`). Fixed meanings — use the maps in `lib/status.ts`
(`MASTERY`, `QUIZ_KIND`, `scoreColor`), don't pick colours ad hoc:

| Colour | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| gray   | new / not started / not taken                            |
| yellow | learning · score 50–79 %                                 |
| green  | mastered / correct · score ≥ 80 %                        |
| red    | struggling / wrong · score < 50 %                        |
| orange | due for review · review quizzes · carried-over questions |
| blue   | in progress / selected · checkpoints                     |
| purple | exams                                                    |

**Type** — one font (`--font-sans`, SF Pro on a Mac), mono only for code.
Title 40/48 bold (PageHeader) · H1 30 · H2 24 · H3 20 semibold · body 16/24 (reading pages) ·
UI 14/21 (sidebar, tables, menus, dialogs, panel) · meta 13 · small 12. Numbers in tables and
scores use `font-variant-numeric: tabular-nums`.

**Spacing** — 4 px grid: `--space-1…24` = 4 8 12 16 20 24 32 48 96. **Radii** — 4 controls, tags,
rows (`--radius-control`) · 6 menus, cards, callouts (`--radius-menu`) · 12 dialogs, panel, toast,
quiz card, ask bar (`--radius-panel`). **Shadows** — `--shadow-sm` cards · `--shadow-md` popovers ·
`--shadow-lg` menus, dialogs · `--shadow-button` secondary buttons · `--shadow-focus` focus ring.
**Layers** — `--z-sticky` 10 < popover 100 < dialog 200 < toast 300 < tooltip 400.

## Components — when to use which

| Component                                                               | Use for                                                                    | Notes                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Button` primary                                                        | the one main action of a surface                                           | blue; `shortcut="⌘E"` shows the hint                        |
| `Button` secondary / ghost                                              | other actions / quiet actions in bars and footers                          | `danger` for destructive; `loading` keeps width             |
| `IconButton`                                                            | icon-only actions                                                          | `label` is required (tooltip + screen reader)               |
| `Tag`                                                                   | status, type, score                                                        | colour = meaning (table above)                              |
| `ProgressBar`                                                           | mastery, exam progress                                                     | thin 4 px, green default; give it a `label`                 |
| `Callout`                                                               | something to act on or notice (gaps, struggling, tips)                     | emoji + bold title; `color` tints it                        |
| `ToggleBlock`                                                           | detail people open on demand (review answers, step prompts)                | controlled or not                                           |
| `Choices`                                                               | 2–4 short exclusive options in one line (5/10/20, difficulty)              | segmented control                                           |
| `RadioGroup` + `RadioRow`                                               | options that need a hint line; quiz answers                                | arrow keys; `tone` correct/wrong; `keyHint`                 |
| `Checkbox`, `Switch`                                                    | to-dos and multi-select / on-off settings that apply at once               |                                                             |
| `Input`, `Textarea`, `Field`                                            | text entry with label + hint/error                                         |                                                             |
| `Dialog`                                                                | short focused tasks (New exam, New subject)                                | 520 px (`wide` 680), footer = note + ghost Cancel + primary |
| `Menu`, `Popover`, `Tooltip`                                            | row/page menus · small floating forms · names + shortcuts of icons         |                                                             |
| `toast()` + `<Toaster/>`                                                | confirmations after an action ("Prompt copied")                            | `tone`, one `action`, auto-hides                            |
| `DatabaseTable`                                                         | lists of things with properties (exams, concepts)                          | header icons, 36 px rows, row click, `Count n`              |
| `ViewTabs`                                                              | switching views of one object (subject: Roadmap / Concepts / Seen / Exams) |                                                             |
| `Page`, `PageHeader`, `PropertyList`/`Property`, `Section`              | every page's skeleton                                                      | see layout                                                  |
| `QuizQuestion`                                                          | one MCQ with instant feedback + rationale                                  | exams, reviews, onboarding                                  |
| `RoadmapItem`                                                           | roadmap steps (to-do) and checkpoints (callout)                            |                                                             |
| `Kbd`                                                                   | shortcut hints inline (`boxed` for keycaps)                                |                                                             |
| `LoadingState`, `Skeleton`, `EmptyState`, `ErrorState`, `Spinner`       | states (below)                                                             |                                                             |
| `CommandPalette`, `Sidebar*`, `TopBar`/`Breadcrumbs`, `SpectaclesGlyph` | app shell only                                                             |                                                             |

## Layout

- Designed for the 1200 × 800 app window. Sidebar 240 px on `--c-bacSec`, 30 px rows, traffic lights in
  its top 44 px row; ⌘\ hides it (the top bar then insets 78 px for the traffic lights).
- Every page renders `PageFrame` (pages/PageFrame.tsx): 44 px top bar with breadcrumbs left and at
  most one primary + a few ghost actions right; the page column scrolls under it.
- Page column (`Page`): `default` 708 px reading column — subject, exam, settings, onboarding;
  `wide` 900 px — tables (exams list, inbox); `full` — rare. Gutters `clamp(24px, 8vw, 96px)`, so at
  1200 px a `wide` table really has 768 px: give the name column the slack and fixed widths
  to the rest; long names truncate with a `title` tooltip.
- `PageHeader`: 64 px top padding, 78 px emoji icon, 40 px title, one secondary subtitle line built
  with " · " separators (e.g. "10 questions · 🧪 Organic Chemistry · about 8 min"), then
  properties or a tip. First content block ~28 px below; `Section`s 36 px apart with a small grey
  title and a hairline.
- Spacing inside blocks 8–16 px; between blocks 24–36 px; question blocks 32 px with a hairline
  between. Sticky strips (exam progress) sit on `--c-bacPri` with a bottom hairline.
- Emoji for subjects and page icons; Lucide line icons for UI. Never mix both in one row.

## States (every page has all of them)

- **Loading** — `LoadingState` with a specific caption ("Loading your exams…", "Writing 10
  questions on Organic Chemistry…") and a skeleton shaped like the content (table rows, question
  blocks). No bare spinners on pages.
- **Empty** — `EmptyState`: short title ("No exams yet"), one sentence of why/what next, exactly
  one primary action — and when that action needs something missing first, offer that instead
  (no subjects → "New subject"). Hide the duplicate top-bar action while empty.
- **Error** — `ErrorState` with the error's message (or "Dumbledore couldn't load this. Your data
  is safe.") and "Try again". Failed AI work gets its own empty state with a way forward.
- **Working on something** — say what is happening, keep the page usable, and poll as a fallback
  to push events (`memory.changed`).
- Every state renders inside the normal frame: breadcrumbs and header stay put.

## Motion

- `--dur-fast` 150 ms (hover, press, toggles), `--dur-base` 200 ms (fade/pop-in of menus, dialogs,
  toasts, feedback), easing `--ease-out`. Skeletons pulse 1.6 s; spinners 700 ms.
- `prefers-reduced-motion: reduce` sets both durations to 0, stops the skeleton pulse and slows
  spinners; smooth scrolling turns off. Don't add animations that ignore these tokens.

## Copy

Short, warm, concrete; sentence case; "Dumbledore" is the actor ("Dumbledore turned them into
one prompt below"). Name the subject and number ("3 to work on"). Curly quotes and the real
ellipsis (…). Prompts are pasted, never sent — say so ("read it, then press Enter there").

## Do / Don't

- Do keep one primary (blue) button per surface; everything else secondary or ghost.
- Do use colour only through the meaning map; grey for everything else.
- Do label icon buttons and progress bars; keep focus rings (`--shadow-focus`, keyboard only).
- Do test both themes — `ui-screens.spec.ts` shoots every route light and dark.
- Don't use raw hex, new font sizes or off-grid spacing in page CSS.
- Don't put more than one sentence in an empty state, a toast or a tooltip.
- Don't hide information only in a tooltip; tooltips name things and show shortcuts.
- Don't restyle `dd-*` classes from pages; ask for a design-system change instead.
