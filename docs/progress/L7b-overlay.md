# L7b Overlay — status
Updated: 2026-10-24T19:05

## Scope
- ✅ Overlay page scaffold (overlay.html, main.tsx, api bridge, state hook, `?display=` filter, hit-area hover reporting with re-test on DOM change)
- ✅ Orb (idle · paused · thinking · session ring · dot · docked, hover tooltip, drag/click/long-press/right-click; cross-display drag keeps the scene until drop)
- ✅ Side stack (Next with k/n hover label, Quiz; long-press → orbLongPress)
- ✅ Study pill → pillClick
- ✅ Suggestion chip beside docked orb → chipClick (truncates to room; above the chat box when tight)
- ✅ Toasts (grow out of orb, ttl auto-hide, hover pause, collapse → toastDismiss; actions sent at once)
- ✅ Quiz card (quiz.get poll while generating, resume, keys 1–4/Enter/Esc, quiz.answer feedback, dots, quiz.finish result, Fix my gaps)
- ✅ Ask bar page (askbar.html, Enter → ask.submit, markdown reply, action chips, chat.delta streaming on thread 'ask', setSize, Esc)
- ✅ Mock driver + Vite dev config (`npx vite --config src/renderer/surfaces/overlay/vite.config.mjs` → :5181)
- ✅ Playwright `tests/e2e-sim/overlay-screens.spec.ts` (own Vite server; 36 screenshots light/dark; interaction checks) — 12/12
- ✅ Vitest 7 files / 65 tests · tsc web + node clean for my files · biome clean · prod build of both pages OK

## Next
- Nothing open in this lane. Integration: see issues below.

## Open issues / requests for the integrator
- Quiz keys 1–4 and Esc only reach the card if main forwards them (overlay is non-focusable); `pressEnter('overlay')` already covers Enter / right ⌥.
- Ask bar window: transparent, card draws its own 12 px corners; native shadow suits it (`hasShadow: true` + `invalidateShadow()` after resize). Links in replies use target=_blank → needs a window-open handler (shell.openExternal).
- orbDrag x/y are in the sending overlay's coordinates and may fall outside its bounds during a cross-display drag (main already converts).
- Toasts are hidden while the quiz card is open (they reappear with a fresh ttl).
