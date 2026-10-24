# L1b Helper tests — status
Updated: 2026-10-24T19:00:00Z

## Scope
- ✅ `tools/mock-chat/`: `page.ts` (ChatGPT look-alike, contenteditable composer with placeholder
  "Ask anything", send button, message list, canned answers), `server.ts` (library:
  `startMockChat`), `serve.ts` (runnable: `npx tsx tools/mock-chat/serve.ts`, 127.0.0.1:5199).
  `GET /state` → `{ input, messages, sends, inputUpdates, pageConnected, closed }`. The page reports
  every composer change (typing, paste, and edits that fire no input event via a MutationObserver),
  one report in flight at a time. Commands for E2E: `POST /api/reset | /api/focus | /api/close`.
  The old `main.ts` entry was folded into `serve.ts`.
- ✅ Fixtures: `native/helper/tools/RenderFixtures.swift` (`bash native/helper/build.sh fixtures`) →
  `tests/fixtures/screens/{document,chat-light,chat-dark,slide,two-column,ui-small}.png|json`:
  heading, body, 10–13 pt UI text, Swedish + Finnish with ä/ö/å, ChatGPT/Claude-like chat. Ground
  truth per line: text, box in points, font size, expected align, chat role.
- ✅ `native/helper/tools/ocr-score.ts`: ground-truth + `ocr-file` schemas, runner, order-independent
  character accuracy (edit distance over grouped lines; usable by `tools/bench.ts`).
- ✅ `tests/integration/helper-ocr.test.ts`: accuracy 99.48–99.89 % per fixture (threshold 97 %),
  Nordic letters (no Ă), alignment, chat reading order, stable dHash, ocr-file error exits.
  Latency is logged (300–500 ms per fixture); DUMBLEDORE_PERF=1 enforces the 450 ms median.
- ✅ `tests/integration/helper-rpc.test.ts` (raw socket): malformed lines, batches / non-objects /
  missing jsonrpc or method, unknown methods + silent unknown notifications, invalid params on 8
  methods (never a side effect), id echoing, pipelined / split / CRLF lines, 1 MB junk line,
  several clients. 17 MB line test only with DUMBLEDORE_SLOW=1 (see issues).
- ✅ `tests/integration/helper-process.test.ts`: version / selftest / unknown command, socket 0600 in a
  0700 dir, second helper exits 75, SIGTERM cleanup, stale socket after SIGKILL, --parent-pid
  (parent dies / already dead), too-long socket path.
- ✅ `tests/integration/helper-client.test.ts` (SocketHelperClient + spawnLauncher): connect, ping /
  permissions.status / system.displays / system.idle / llm.onDevice.status / frontmost through the
  zod schemas, client- and helper-side invalid params, reconnect after SIGKILL, adopting a running
  helper, stop() terminates the helper.
- ✅ `tests/integration/helper-mockchat.test.ts`: server API + the real page in headless Chromium.
- 🚧 `tests/integration/helper-live.test.ts` (DUMBLEDORE_LIVE=1): perceive frontmost + forced OCR
  ran green once; the mock-chat write test (opens a Chrome window, `ax.findChatInput`,
  `input.write`, checks `/state`) is written but not run, since it types into the user's screen.

Result: `npx vitest run tests/integration` → 48 passed, 1 expected fail, 4 skipped (live/slow).

## Next
1. Run `DUMBLEDORE_LIVE=1 npx vitest run tests/integration/helper-live.test.ts` while nobody uses the Mac.
2. Flip the `it.fails` alignment test to `it` once Layout.swift is fixed.

## Open issues / requests for the integrator
- Layout.swift alignment on chat layouts (9 of 30 role lines wrong): rows below the sidebar are
  measured against the whole window, so assistant text and the centred footer read `right`; a
  multi-line user bubble split off as its own column reads its widest line as `left`. Encoded as
  `it.fails('known issue: every chat line has its role alignment')`.
- Server.swift line reader rescans the whole buffer for `\n` after every read, so a single line
  costs O(n²): 1 MB 0.2 s, 4 MB 3.4 s, 8 MB 14 s; the 16 MB "line too long" guard takes > 1 min.
  Fix: remember the scanned offset.
- Typical Vision slips seen in the fixtures: `·`→`•`, `4o`→`40`, `0`→`O`, `AI`→`Al`, `…`→`...`.
- `docs/progress/L1-helper.md` still lists mock-chat and the integration tests as not started.
