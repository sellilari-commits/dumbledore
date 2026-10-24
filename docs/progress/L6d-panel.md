# L6d Mini panel — status
Updated: 2026-10-24T19:40:00Z

Owns: `src/renderer/panel.html`, `src/renderer/surfaces/panel/**`, `tests/e2e-sim/ui-panel*.spec.ts`,
`tests/e2e-sim/__screenshots__/ui-panel-*`.

## Scope
- ✅ Entry (`main.tsx`) + `PanelApp` (providers, hash routes `/` and `/picker`, main's `navigate`
  events, theme sync). In Electron the card fills the 380×580 transparent window (12 px corners,
  hairline edge); with `?mock=1` it floats on a neutral stage.
- ✅ Header: spectacles glyph + "Dumbledore", focus menu (settings.update, optimistic), capture
  switch (capture.setEnabled, optimistic, tooltip ⌃⌥⌘P), ⤢ open app (window.open)
- ✅ Right now: NowContext (app, page, host, minutes, subject emoji) + suggestion button
  (coach.runAction); paused-capture state with Resume. One primary action per surface: the
  suggestion turns secondary while a session runs or an AI chat is open.
- ✅ Session: mini roadmap (✓ last done inline, ▸ current, ○ next two, checkpoints with question
  count), "▸ Next prompt ⌥" / "Quiz ⌥" / "Finish roadmap" (session.next), planning, paused (Resume
  → session.start), error (Try again), complete; "Start studying" → `#/picker` when an AI chat is
  open and no session.
- ✅ Goals & due: 3 nearest deadlines (→ subject in app), due reviews + Start review
  (start_review), Quick exam = exams.create(focus subject, 5, weak, mixed) → app `/exams/:id`
- ✅ Subjects: emoji, name, progress bar → app subject page; "N suggested · Review in Inbox"
- ✅ Chat: thread 'panel', last 6 messages + "Show earlier", streamed reply with caret, markdown,
  action chips (coach.runAction), starter questions, sticky autofocused input (Esc clears, then
  closes), follows the conversation while a reply streams
- ✅ Picker `#/picker`: "What do you want to learn?" combobox, subjects (Resume / due tags) and their
  questions, filter + "Learn “…”", ↑↓ Enter, click, Esc → window.close('panel'); after
  session.start it closes and returns to `/`
- ✅ Vitest: `MiniPanel.test.tsx` (12) + `picker/Picker.test.tsx` (8) — 20 green
- ✅ Playwright `tests/e2e-sim/ui-panel.spec.ts` (7 green): screenshots light/dark
  `ui-panel-{home,bottom,focus,chat,empty,picker,picker-typed}-{light,dark}.png`, reviewed
- ✅ Preview: `npx vite --config src/renderer/surfaces/panel/vite.config.mjs` → :5185
  (`/panel.html?mock=1`, `#/picker`, `&scenario=empty|slow|error`, `&theme=dark`)

## Next
1. Swap `usePanelChat` back to lib's `useChat` once lib/chat.ts has the fix below.
2. Check the panel inside Electron once L7a gives it a native shadow.

## Open issues / requests for the integrator
- **lib/chat.ts bug (L6):** `useChat` re-renders without end while `chat.history` is loading or has
  failed — `stored = history.data ?? []` is a new array every render, so its effect runs every
  render and `setPending(p => p.filter(…))` always returns a new array (hangs vitest in the
  `error` scenario, burns CPU in `slow`). Fix: a module-level empty array (or useMemo) and return
  `p` unchanged when nothing was confirmed; also drop the optimistic message when `chat.send`
  fails. The panel uses a fixed local copy, `surfaces/panel/chat/usePanelChat.ts`.
- **L7a:** panel window uses `typingOptions` with `hasShadow: false`; the card draws its own corners
  and hairline and wants the native shadow (`hasShadow: true` + `invalidateShadow()`), like the
  ask bar.
- **Design system (minor):** `Switch` doesn't spread extra props, so `Tooltip` can't wrap it directly
  (wrapped in a span → hover-only tooltip). Surface stylesheets load before design-system CSS
  (component imports come later), so `.dd-*` overrides need extra specificity.
- Mock has no URL scenario for "AI chat open, no session" (unit tests set `db.sessionRoadmapId`).
