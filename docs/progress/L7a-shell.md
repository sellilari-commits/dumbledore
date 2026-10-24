# L7a Shell — status
Updated: 2026-10-24T18:45:00+03:00

## Scope
- ✅ Composition root `src/main/compose.ts` + fakes in `src/main/fakes/` (helper, perception, study, prompts, quiz, queries, subjects, follow-ups, secrets, providers, demo seed) — compiles
- ✅ Overlay controller (`src/main/overlay/`): geometry, toasts, controller — unit-tested
- ✅ Shortcut router (`src/main/router/`): decision table, pending work (Esc), suggestion cache, router — unit-tested (decision table + end-to-end flows)
- ✅ ChatWriter + FocusKeeper (`src/main/chat/`) — unit-tested with the fake helper
- ✅ Flows (`src/main/flows/`): session, ask + `/d`, coach chat, coach actions, nudges, app state — compiles
- ✅ Shell core graph `src/main/shell.ts` (no Electron)
- ✅ IPC (`src/main/ipc/`): handlers for every channel, validated registration, broadcast routes — unit-tested (every channel answered with a contract-valid response)
- ✅ Electron layer: windows (overlay per display, panel, ask bar, app + Dock), tray (procedural template icon), CSP + `dumbledore://` protocol, global chords, safeStorage secrets, lifecycle (`index.ts`/`app.ts`) — compiles + bundles; not run (no Electron binary)
- ✅ Test-control channel (DUMBLEDORE_TEST=1) — `src/main/test-control/`; tests pending
- 🚧 Unit tests: router, overlay, ChatWriter, IPC done; test-control, protocol, tray icon pending · ⬜ Playwright smoke spec

## Next
1. Tests for test-control, protocol/urls/placement, tray icon.
2. Playwright smoke spec `tests/e2e-sim/shell-smoke.spec.ts`.

## Open issues / requests for the integrator
- Electron binary is not installed in `node_modules/electron/dist` (npm install-scripts policy skipped its postinstall). `npm run dev` and Playwright need `node node_modules/electron/install.js` (downloads ~120 MB from GitHub).
