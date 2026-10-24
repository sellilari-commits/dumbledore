# Z Real-run fixes — status
Updated: 2026-10-24T20:40:00Z

## Scope
- ✅ Bug 1 lost step: `StudyService.pasteFailed(itemId)` (contracts.ts, additive). Engine: `unpasted.ts`
  clears promptSent and keeps the prompt, next() re-hands it word for word (no brain call, no double
  memory updates). SessionFlow calls it on a failed, cancelled or aborted paste; toast "Try again" =
  `retryStep` (no-op once delivered). Fake + `withoutSessionEcho` implement it. Tests:
  `paste-failed.test.ts`, `session-flow.test.ts`; `ipc.test.ts` now gives the paste a chat (inChatGPT).
- ✅ Bug 2 ChatWriter: every failure of a chat-target write copies (also "app changed", which used to
  only offer "Copy instead"); Dumbledore itself frontmost → hand focus back instead of giving up;
  after a helper timeout the text is copied again past the helper's 400 ms clipboard restore; toast
  "Couldn't paste into ChatGPT — copied, press ⌘V" + "Try again". Tests in chat-writer.test.ts.
- ✅ Bug 3 subject naming: `subject-fields.ts` + `subject-naming.ts` (field from keywords / explicit
  field name, existing field subject or alias reused, emoji), better `deriveSubjectName`; a
  topic-named new subject is renamed (or folded into the existing field subject) from the plan's
  title/concepts/drafts. No LLM call. Tests: subject-naming.test.ts.
- ✅ Bug 4 app.ts: in-memory clipboard in test mode (`testClipboard`).
- ✅ Bug 5 memory-text.ts: Seen/Big picture/evidence in plain words, context labels stripped,
  phrases de-duplicated. Tests: memory-text.test.ts.

## Open issues / requests for the integrator
- A helper `input.write` result `ok: true, verified: false` still counts as pasted (multi-paragraph
  prompts may read back differently in ChatGPT's composer); if the live test shows silent misses,
  treat `readBackDiffers` as a failure.
- If the student pastes by hand with ⌘V after a failure, the next tap pastes the step again.
- Not mine: tsc errors in src/engine/perception/episodes/builder.ts (leftChat); test-control
  server.test.ts 'askbar' failure; contracts.ts has pre-existing Biome format issues.
