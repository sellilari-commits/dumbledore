# L1 Helper — status
Updated: 2026-10-24T19:10:00Z

## Scope
- ✅ Swift package `native/helper` + `build.sh` (raw binary + `Dumbledore Helper.app`, ad-hoc signed); `selftest` 41/41
- ✅ JSON-RPC 2.0 server over Unix socket (`--socket`, `--parent-pid`), Codable mirrors; smoke-tested (ping, errors, displays, idle)
- 🚧 `perceive` (AX text walk, Chromium AXManualAccessibility, AXURL, OCR fallback, dHash, reading order + alignment)
- 🚧 Focus tracking (`focus.changed`, `app.activated`), FocusedElement + refs
- 🚧 Trigger key polling (tap / doubleTap / holdStart / holdEnd, secureInput)
- 🚧 `ax.findChatInput`, `ax.focused`, `ax.readFocusedValue`, `ax.selectedText`
- 🚧 `input.write` (AX / paste, clipboard save+restore), `input.click`, `input.key`, `app.activate`
- 🚧 System: idle, displays, lock/unlock, display.changed, permissions.status/request
- 🚧 On-device LLM (FoundationModels) status/generate
- ✅ TS `src/engine/helper/`: client (SocketHelperClient), launcher, connection, framing, events hub, fake (FakeHelper), fixtures, recorder, index + 21 unit tests green
- ⬜ `tools/mock-chat/` (page + serve.ts on :5199)
- ⬜ Integration tests (`tests/integration/helper*.test.ts`), fixtures in `tests/fixtures/screens/`
- ⬜ `native/helper/README.md`

## Next
1. tools/mock-chat (page + serve.ts)
2. Fixture renderer (native/helper/tools/RenderFixtures.swift) + tests/fixtures/screens + OCR accuracy test
3. Integration tests (rpc robustness, selftest, live gated), README
4. Live checks once the screen is unlocked (it was locked during the build: perceive returns [] while locked)

## Open issues / requests for the integrator
- (none yet)
