# L7a Shell — status
Updated: 2026-10-24T19:02:00+03:00

## Scope
- ✅ Composition root `src/main/compose.ts` + fakes in `src/main/fakes/` (helper, perception, study, prompts, quiz, queries, subjects, follow-ups, secrets, providers, demo seed)
- ✅ Overlay controller (`src/main/overlay/`): geometry, toasts, controller — unit-tested
- ✅ Shortcut router (`src/main/router/`): decision table, pending work (Esc), suggestion cache, router — unit-tested
- ✅ ChatWriter + FocusKeeper (`src/main/chat/`) — unit-tested with the fake helper
- ✅ Flows (`src/main/flows/`): session, ask + `/d`, coach chat, coach actions, nudges, app state
- ✅ Shell core graph `src/main/shell.ts` (no Electron)
- ✅ IPC (`src/main/ipc/`): every channel incl. `profile.get/update`, `data.export`, `data.deleteAll`, `'gemini'` in `secrets.set`/`providers.test`; `key.gesture` → app window (helper gestures; the fallback chord sends `{ gesture: 'tap', key: 'fallbackChord' }`) — unit-tested
- ✅ Data (`src/main/data/`): JSON export through the Repos interface → `<data dir>/exports/` (0600) + reveal in Finder; delete-all = stop services → clear Chromium storage → wipe db (+wal/shm/journal), memory/, exports/, secrets.json → relaunch (test mode: quit). `spend-ledger.jsonl` is never wiped (guard in wipe.ts)
- ✅ Overlay-lane requests: quiz keys 1–4 / Enter / Esc grabbed globally only while the quiz card is open and injected into the overlay with `sendInputEvent` (Esc shared with pending-work cancel; not grabbed in test mode); ask bar `hasShadow` + `invalidateShadow()` after resize/show; `target=_blank` / window.open → `shell.openExternal` (http, https, mailto only) in `security.ts`
- ✅ Electron layer: windows, tray, CSP + `dumbledore://` protocol, global chords, safeStorage secrets, lifecycle (`index.ts`/`app.ts`), hardening (`security.ts`), dev renderer diagnostics (`diagnostics.ts`: preload/load failures and console errors in the terminal)
- ✅ Test-control channel (DUMBLEDORE_TEST=1) — `src/main/test-control/` (+ `POST /key` for quiz keys)
- ✅ Unit tests: 11 files / 116 tests green (`npx vitest run src/main --exclude 'src/main/real/**'`)
- ✅ Playwright `_electron` smoke `tests/e2e-sim/shell-smoke.spec.ts`: 5/5 (overlay per display, non-focusable + on top, orb drawn once; IPC round-trip + payload refusal + CSP blocks inline script; panel opens via IPC as its own surface; test-control + tray; quiz keys reach the non-focusable overlay)
- ✅ `npm run dev`: app starts with 1 overlay (orb idle, right edge) + tray icon, no renderer errors; quits cleanly
- ✅ tsc (node project) 0 errors · biome clean for src/main (minus real/), src/preload, the spec

## Next
- Nothing open in this lane.

## Open issues / requests for the integrator
- Startup composition: `start()` in `src/main/app.ts` calls `compose()` from `src/main/compose.ts` (fakes). Swap that one call for the real composition; it must return `{ services: Services, fakes }` (`fakes: { helper: null, perception: null }` for real — test-control then omits the /fake endpoints). `Services.stop()` should release the SQLite store: delete-all calls it before wiping the files.
- E2E: run `npx electron-vite build` before `npx playwright test tests/e2e-sim/shell-smoke.spec.ts` (it launches out/main/index.js with a temp DUMBLEDORE_DATA_DIR).
- Renderer (L6): Settings → Data can now call `data.export` / `data.deleteAll({ confirm: true })`; "About you" can use `profile.get/update`; onboarding can listen to `key.gesture`. Delete-all relaunches the app (first run → onboarding) and also removes exports in the data folder — say so in the confirm dialog. In `npm run dev` the relaunched app needs the dev server, which stops with the old process.
- Export covers chat threads `ask`, `panel`, `app` and `subject:<id>` (ChatRepo cannot list threads).
- While the quiz card is open, 1–4 / Enter / Esc are taken from other apps (released on close).
