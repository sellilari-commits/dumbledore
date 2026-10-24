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
