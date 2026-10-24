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
