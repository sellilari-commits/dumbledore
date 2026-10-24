# Dumbledore Helper

A small background macOS app (Swift 6, no Dock icon) that does everything the Electron engine
cannot: read window text (Accessibility first, Vision OCR as fallback), track the focused field,
detect the trigger-key gestures, write into fields, and run Apple's on-device model. The engine
talks to it over JSON-RPC on a Unix socket. Images never leave the helper: only text, boxes and
hashes cross the socket.

## Build

```sh
native/helper/build.sh            # release (default)
native/helper/build.sh debug      # -Onone -g
native/helper/build.sh fixtures   # re-renders tests/fixtures/screens (tools/RenderFixtures.swift)
```

- Needs only the Command Line Tools (no Xcode): Swift 6.3, macOS 15+ target, Swift 6 language mode
  (strict concurrency). A rebuild takes about 20 s.
- Outputs `build/dumbledore-helper` (raw executable, used in development) and
  `build/Dumbledore Helper.app` (`LSUIElement`, bundle id `org.stuhi.dumbledore.helper`).
- Signing: ad-hoc by default. Set `SIGN_IDENTITY` to a stable certificate so macOS keeps the
  app's Accessibility / Screen Recording grants across rebuilds.
- `Package.swift` exists for SourceKit-LSP and `swift build`; `build.sh` is the supported build.

## Run

```sh
build/dumbledore-helper serve --socket <path> [--parent-pid <pid>] [--verbose]
open -n -g -a "build/Dumbledore Helper.app" --args --socket <path> --parent-pid <pid>
```

- Default socket: `~/Library/Application Support/Dumbledore/run/helper.sock` (directory 0700,
  socket 0600, peers must be the same user). Paths are limited to 103 bytes.
- Prints `{"ready":true,"pid":…,"protocol":1}` on stdout once listening.
- Exits with the parent (`--parent-pid`) and on SIGTERM/SIGINT/SIGHUP, removing the socket.
- Exit codes: 0 normal, 1 startup failure, 2 usage, 75 another helper already listens on the path.
- `--verbose` logs debug lines (timings, never screen text) to stderr.
- Other commands: `selftest [--verbose]`, `ocr-file --image <png> [--scale 2]` (the exact OCR
  pipeline on an image, JSON out), `version`.

The TypeScript side (`src/engine/helper/`) launches it (`spawnLauncher` in development,
`appLauncher` when packaged), reconnects with backoff and replays `shortcut.configure`.

## Protocol

JSON-RPC 2.0, one JSON object per line. The source of truth is
[`src/shared/helper-protocol.ts`](../../src/shared/helper-protocol.ts); `Protocol.swift` mirrors it
(change both together). Every `.nullable()` field is always present, as `null` when empty.
Coordinates are global screen points, origin top-left of the main display.

| Method | What it does |
|---|---|
| `ping` | protocol version, pid, permission snapshot |
| `permissions.status` | `{accessibility, screenRecording}`; never prompts |
| `permissions.request {kind}` | shows the system prompt where one exists and opens the Privacy pane |
| `frontmost` | app, window id/title/frame, full screen, browser URL (AXURL, no Automation prompt) |
| `perceive {scope, minChange, allowOcr, forceOcr, maxChars, excludeBundleIds}` | window text in reading order (see below) |
| `ax.focused` | the focused element: role, editable, isSecure, frame, caret, placeholder, valueLength, ref |
| `ax.readFocusedValue` | focused field text; only on an explicit user action; refuses password fields |
| `ax.selectedText` | current selection (AXSelectedText, else text markers); refuses password fields |
| `ax.findChatInput {pid, placeholders}` | chat box: focused field → AX search → OCR of the placeholder |
| `input.write {text, mode, target, method, expectPid, restoreClipboard}` | writes without sending (see below) |
| `input.click {x, y}` · `input.key {combo}` | synthetic click / key combo ("cmd+a", "escape", "shift+enter") |
| `app.activate {pid}` | hands focus back to an app |
| `system.idle` · `system.displays` | seconds since last input · displays with frame, visible frame, scale, notch |
| `shortcut.configure {key, tapMaxMs, holdMinMs, doubleTapMs, enabled}` | trigger-key gestures |
| `llm.onDevice.status` · `llm.onDevice.generate {instructions, prompt, schema, …}` | FoundationModels with JSON-Schema-guided output |

Events (notifications from the helper): `focus.changed {app, element}` (also re-sent to every new
client), `app.activated`, `key.trigger {gesture, key, secureInput}`, `screen.locked`,
`screen.unlocked`, `display.changed {displays}`, `helper.log {level, message}`.

Errors: standard JSON-RPC codes plus -32001 permission denied, -32002 not found, -32003 timeout,
-32004 secure input. Invalid params name the key (`params.scope is required`).

Requests run off the main thread: quick reads on a concurrent queue, `perceive`, `input.*` and the
model each on their own serial queue (input actions never interleave).

### perceive

- Never reads Dumbledore's own windows (`org.stuhi.dumbledore*`, `com.github.Electron`), the lock
  screen, or `excludeBundleIds`; returns `[]` while the screen is locked.
- `frontmost`: the focused window. `visible`: up to 6 windows, front to back; besides the front
  window only those covering ≥ 25 % of a display and ≥ 30 % unoccluded.
- Accessibility walk: depth ≤ 64, 150 ms budget, off-window subtrees pruned, inline runs merged
  into visual lines. Never reads the focused field, single-line fields or password fields.
  Chromium/Electron apps get `AXManualAccessibility` (frontmost only, once per process; Chrome
  answers "unsupported" and builds its tree on first query).
- OCR fallback (needs Screen Recording) when the AX text has < 200 characters, the app is on the
  OCR list (Preview, Keynote, PowerPoint, video players), or `forceOcr`. ScreenCaptureKit window
  capture at native resolution, Vision `.accurate`, `en-US` + `sv-SE`, language correction and
  auto-detect off, Ă→Å fix. Lines come back in reading order (XY-cut, column- and chat-aware) with
  `left`/`center`/`right` alignment relative to their column.
- Change detection per client connection: AX text hash; for OCR a 64-bit dHash per window, re-OCR
  only when the Hamming distance ≥ `minChange` or the last OCR is older than 30 s. Unchanged →
  `changed: false`, `lines: []`, same `contentHash` (`ax:…` or `ocr:…`).

### input.write

Refuses password fields and secure keyboard input, aborts when the frontmost pid is not
`expectPid`, and fails with `targetGone` when `target.ref` no longer resolves (it never redirects
text into whatever has focus instead). `auto` picks Accessibility insertion for native fields and
⌘V for Chromium/Electron/web content; an AX write that changes nothing falls back to paste.
Paste saves every pasteboard item and type, writes the text marked
`org.nspasteboard.TransientType`, posts ⌘V with the layout's key code from a private event source
(only ⌘ set, so a held ⌥ cannot leak in), and restores the clipboard ~400 ms later if it is still
ours. Every write is read back (`verified`).

### Trigger key

A thread polls the modifier state at ~100 Hz (device-dependent bits tell left from right): no event
tap, no Input Monitoring permission. Any key or click while the key is down cancels the gesture
(⌥2 = @ never fires). `tap` on release (≤ tapMaxMs); a second clean tap starting within
doubleTapMs emits `doubleTap` (after the first `tap`); holding ≥ holdMinMs emits `holdStart`, the
release `holdEnd`. Each event says whether secure input is on.

## Permissions

- **Accessibility** (required): AX text, focus tracking, `ax.*`, `input.*`. Without it those methods
  return -32001 and focus events carry `element: null`.
- **Screen Recording** (required by the app for PDFs, slides and video): the OCR fallback and the
  OCR placeholder search. Without it the helper runs on Accessibility text alone.
- The helper is always a child process and inherits its parent's grants: the terminal's / IDE's in
  development, Dumbledore.app's when installed (it is embedded as `Dumbledore Helper.app` but
  started from Dumbledore, not opened as its own app). `permissions.status` never prompts;
  `permissions.request` triggers the prompt and opens the right System Settings pane. Accessibility
  can be granted while the helper runs: focus tracking attaches within 2 s.

## Tests

```sh
build/dumbledore-helper selftest        # no screen, no permissions; ~1 s
native/helper/scripts/live-check.sh     # this Mac, passive: reads, never types or clicks
native/helper/scripts/live-check.sh --watch 20   # + print events (press right ⌥, switch apps)
native/helper/scripts/live-check.sh --write-test # manual: writes one line into the focused field
npx vitest run src/engine/helper        # TS client against the fake helper
```

`selftest` covers the gesture classifier, reading order, key combos and layout key codes, JSON and
JSON-Schema conversion, protocol encodings and param defaults, the router's error codes over a
socketpair, a real socket server, clipboard save/restore on a private pasteboard, dHash, OCR of a
rendered image, and the read-only system probes. `live-check.sh` runs the helper on a private
temporary socket and skips the screen checks while the screen is locked. Integration tests live in
`tests/integration/helper*.test.ts`.

## Source map

| File | Responsibility |
|---|---|
| `main.swift`, `HelperMain.swift` | commands, `serve` lifecycle, signals, parent watch |
| `Server.swift`, `Router.swift`, `JSON.swift`, `Protocol.swift`, `Handlers.swift` | socket, JSON-RPC, Codable mirrors, method table |
| `Perceive.swift`, `AXText.swift`, `Windows.swift`, `Apps.swift` | perceive / frontmost, AX walk, window list, app facts |
| `Capture.swift`, `OCR.swift`, `Layout.swift`, `ChangeDetect.swift`, `OCRFile.swift` | capture, Vision, reading order, dHash, `ocr-file` |
| `Focus.swift`, `Refs.swift`, `ChatInput.swift`, `AXUtil.swift` | focus tracking, element refs, chat-input finder, AX wrappers |
| `Input.swift`, `Clipboard.swift`, `Keyboard.swift` | writes, clicks, keys, clipboard, layout key codes |
| `Trigger.swift`, `System.swift`, `Permissions.swift` | trigger key, idle/displays/lock, permissions |
| `OnDevice.swift`, `JSONSchema.swift`, `OrderedJSON.swift` | FoundationModels, JSON Schema → generation schema |
| `Log.swift`, `SelfTest.swift`, `SelfTestIO.swift` | logging + events, selftest |
