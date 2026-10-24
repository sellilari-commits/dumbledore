# Integration notes

Collected from lane reports as they land. The composition root (`src/main/compose.ts`) must
follow these when real implementations replace the fakes.

## L4 Study (landed)

Wiring:

```ts
const study = createStudyService({
  repos, brain, clock, bus, mastery, followUp,
  chatExcerpt: (n) => perception.chatExcerpt(n), // optional: prefetch waits 20 s for the AI's answer
})
quizService.setCheckpointHandler((id, result) => study.handleCheckpointResult(id, result))
const prompts = createPromptService({ repos, brain, clock, session: () => study.current() })
```

Behaviour the shell must respect:
- `next()` pastes a step that was never pasted (after a checkpoint or a resume) instead of marking it done.
- `next()` without a session throws `StudyError`; a failed plan or quiz also throws after the session
  state is updated → the shell shows a toast.
- After two failed quiz generations a checkpoint is skipped; its concepts move to the next checkpoint.
- `quiz:open` fires every time a quiz instruction is returned (also re-opens) → handle idempotently.
- The study service emits no `thinking:changed`; the shell shows "thinking" while awaiting `start()`/`next()`.
- `pause()`/`end()` park the roadmap as `'paused'`; a paused session is not restored after restart.
  Home "Continue" must list all non-done roadmaps, not only `listActive()`.
- The checkpoint failure counter is in memory (resets on restart).

## L7b Overlay + Ask bar (landed)

- The overlay window is non-focusable: keys 1–4 / Esc reach the quiz card only if main forwards
  them with `webContents.sendInputEvent`. Enter and right ⌥ go through `pressEnter('overlay')` (L7a).
- Ask bar window: transparent; the card draws its own 12 px corners and wants the native shadow
  (`hasShadow: true` + `invalidateShadow()` after resize). Reply links use `target=_blank` → add a
  window-open handler calling `shell.openExternal`.
- Ask bar streams `chat.delta` on thread `'ask'`.
- Cross-display drag: the scene stays in the window owning the pointer until drop; `orbDrag` x/y are
  in that window's coordinates and may fall outside its bounds.
- Toasts hide while the quiz card is open and return with a fresh ttl.
- Dev server for overlay/askbar: `src/renderer/surfaces/overlay/vite.config.mjs`, port 5181; the
  mock driver loads lazily (`?mock=1` or no `window.dumbledore`).

## L3 Perception (landed)

Wiring:

```ts
const stack = createPerceptionStack({
  helper, repos, bus, brain, // brain: Pick<Brain, 'extract'>
  clock, isLowPower, log, mastery, workerOptions, episodeOptions, // all optional
})
stack.start() // after helper.start()
stack.stop() // on quit; closes open episodes first
stack.perception // the PerceptionService
```

Behaviour the shell must respect:
- Listens on the bus for `settings:changed`, `helper:status`, `helper:appActivated`,
  `helper:screenLocked` and `session:changed`, so helper events must be forwarded onto the bus
  (`bridgeEvents` in compose.ts).
- Emits `perception:window`, `perception:episodeClosed`, `perception:now`, `perception:aiChat`
  and `memory:changed`.
- Capture runs only while `settings.captureEnabled` is on and `perception.setEnabled(true)` is set
  (true by default).
- Blocked windows (password managers, private browsing) leak no text, title or URL into helper
  replies, bus events, LLM input or the database (`src/engine/perception/pipeline.test.ts`).

## L2b Brain (landed)

Wiring:

```ts
const brain = createBrain({
  clock,
  usage: repos.usage, // persistent usage log: daily budgets and the €10 spend cap
  helper, // Apple on-device model
  redact, // from src/engine/privacy
  settings: () => repos.settings.get(), // model overrides per tier, on-device switch
  // keys: default createKeyGetter() reads env + DUMBLEDORE_ENV_FILES (only the 4 key names)
  // spendCapEur: default DUMBLEDORE_BUDGET_EUR or 10
})
brain.spend() // { eur, capEur }; not in the Brain contract
```

- Gemini 3.5 is primary: flash-lite for triage/extract, flash for reason/write/chat. Thinking is
  minimal for triage/extract/write and low for reason/chat. Above the cap Gemini is skipped as
  `over-budget` and calls fall through to OVHcloud and Apple on-device.
- No Groq or Mistral key on this Mac; those routes are skipped.
- `writeStep` rejects with BrainTimeoutError after 2.5 s and callers use the step's promptDraft.
  Flash p90 is 2.4 s, so some steps will use the draft; consider flash-lite for `write` if that
  shows up in dogfooding.
- `gemini-3.5-flash` is no longer on Google's pricing page and may be retired; 3.6 Flash is listed.

## L7a Shell (landed)

- Startup: `start()` in `src/main/app.ts` calls `compose()` (fakes). To run the real engine,
  replace that one call with `composeReal()` from `src/main/real`; it must return
  `{ services, fakes: { helper: null, perception: null } }`.
- `Services.stop()` must release the SQLite store: `data.deleteAll` calls it before deleting the
  database, `memory/`, `exports/` and `secrets.json`, then relaunches the app.
- `data.export` includes only the chat threads `ask`, `panel`, `app` and `subject:<id>`, because
  ChatRepo can't list threads.
- Electron 45 is installed. `npm run dev` starts the orb and the tray. The smoke spec
  (`tests/e2e-sim/shell-smoke.spec.ts`) needs `npx electron-vite build` first.
