# L1 Helper — status
Updated: 2026-10-24T16:12:00Z

## Scope
- ✅ Swift package `native/helper` + `build.sh` (raw binary + `Dumbledore Helper.app`, ad-hoc signed), **Swift 6 language mode**, 0 warnings. `bash native/helper/build.sh fixtures` regenerates the OCR fixtures (`tests/fixtures/screens`).
- ✅ JSON-RPC 2.0 server over a Unix socket (`--socket`, `--parent-pid`), Codable mirrors. Linear-time line reader (17 MB line: 41 ms, was > 1 min); accept-loop shutdown race fixed
- ✅ `perceive`: AX walk (depth 64, 150 ms budget; Claude app 4–5k chars in 70–130 ms), AXManualAccessibility (frontmost Electron, once, 150 ms settle), AXURL recorded during the walk, OCR fallback/forced (0.8–1.5 s full-screen Retina), dHash reuse (~190 ms, no OCR), own windows excluded (also as occluders), `excludeBundleIds`, `[]` while locked
- ✅ Layout: columns-first XY-cut with header rows, text-weighted column edges, right-aligned bubbles as blocks → every chat line in `chat-light`/`chat-dark` has its role alignment (the `it.fails` test in `helper-ocr.test.ts` can be flipped); documents/slides/settings unchanged
- ✅ Focus tracking: `focus.changed` (frame, caret incl. Chromium text-marker fallback, placeholder, isSecure, ref), re-sent on client connect, window move/resize; `app.activated`
- ✅ `ax.focused`, `ax.readFocusedValue`, `ax.selectedText`, `ax.findChatInput` (focused → AX search bottom-first with off-window pruning, all page areas → OCR placeholder)
- ✅ `input.write` / `input.click` / `input.key` / `app.activate` (code complete; refusal paths live-checked; stale `ref` → `targetGone`, never redirected). 🚧 a real write is only checked manually (`live-check.sh --write-test`)
- ✅ System: idle, displays (hasNotch), lock/unlock + display.changed events, permissions.status/request
- 🚧 Trigger key: classifier unit-tested (12 cases); a real key press is a manual check (`live-check.sh --watch 20`)
- ✅ On-device model: compiles with Command Line Tools; status here = `appleIntelligenceNotEnabled` (generate untested live; schema conversion unit-tested)
- ✅ `selftest` 131/131 (~1 s, no screen): gestures, layout, combos, JSON/schema, protocol shapes, params defaults, line splitter, router over a socketpair, real socket server, private-pasteboard clipboard, key maps, dHash, OCR of a rendered image, system probes
- ✅ `native/helper/scripts/live-check.sh` (passive; 21 PASS on this Mac), `README.md`
- ✅ TS `src/engine/helper/` (21 unit tests); `tools/mock-chat/` and `tests/integration/helper*.test.ts` done by L1b (see `L1b-helper-tests.md`): 48 passed, 1 expected-fail now passing, live/slow skipped

## Next
1. Manual: `native/helper/scripts/live-check.sh --watch 20` (tap / double-tap / hold right ⌥, switch apps, lock) and `--write-test` with a scratch field focused
2. Run `DUMBLEDORE_LIVE=1 npx vitest run tests/integration/helper-live.test.ts` while nobody uses the Mac

## Open issues / requests for the integrator
- Flip `it.fails('known issue: every chat line has its role alignment')` in `tests/integration/helper-ocr.test.ts` to `it` (L1 does not own tests/).
- The comments above the `DUMBLEDORE_SLOW` test in `helper-rpc.test.ts` describe the old O(n²) reader; the test now takes ~40 ms and could run by default.
- `ax.findChatInput`'s whole-window fallback (Electron apps with several page areas) is not live-verified with the composer unfocused (checks stay passive).
