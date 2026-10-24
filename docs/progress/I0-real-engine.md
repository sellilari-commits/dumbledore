# I0 Real engine — status
Updated: 2026-10-24T19:20:00Z

## Scope
- ✅ `src/main/real/compose-real.ts`: `composeReal(opts)` → `{ services, fakes: { helper: null, perception: null }, engine, settled(), close() }`
  (types in `types.ts`). SQLite repos in the data folder (`dataDir` › `DUMBLEDORE_DATA_DIR` › ~/Library/Application Support/Dumbledore),
  createBrain on the persistent `repos.usage` + `spendCapEur` (`DUMBLEDORE_BUDGET_EUR`, default 10), SocketHelperClient via the launcher
  (`helper-launch.ts`: dev / packaged / external), perception stack + extraction worker, study + prompts + quizzes (checkpoint handler →
  `study.handleCheckpointResult`) + one shared MasteryModel + FollowUpService, queries, subjects + MemoryMirror (memory/), RealProviderService.
- ✅ Lifecycle (`lifecycle.ts`): start = events bridge → memory mirror → exam recovery → helper (≤ 2 s wait) → perception → follow-ups;
  stop in reverse; idempotent, serialized, restartable. `close()` = stop + settle + close SQLite.
- ✅ Adapters (`adapters.ts`): no duplicate `session:changed`, follow-up once per roadmap, no duplicate nudge toast, helper receptivity
  signals, keys from the SecretStore first then env/.env files.
- ✅ Providers (`providers.ts`): `test(id)` runs P11 on a single-route brain (key check, latency, clean errors); `status()` from keys,
  tests and the helper's on-device status.
- ✅ Tests (`npx vitest run src/main/real`): 7 files, 23 tests green — perception → Inbox (three parts) + suggested subject + memory file;
  study session through the shell's SessionFlow (paste reaches `input.write`, checkpoint grounded in the chat, mastery, carry-over,
  completion + follow-up once); follow-ups (session follow-up nudge, reviews due two days later, review quiz, one toast per nudge);
  restart on the same folder; composeReal unit tests incl. usage log across restarts and Gemini spend cap; providers; adapters; lifecycle.
- ✅ tsc 0 errors in `src/main/real`; `npx biome check src/main/real` clean.
- ✅ Verified: better-sqlite3 13's Node-API prebuild loads under Electron 45 (`ELECTRON_RUN_AS_NODE`), no rebuild needed.

## Next
1. Shell switch (L7a owns app.ts) — see below.
2. Remove adapters as the lanes fix the mismatches listed below.

## Shell switch (src/main/app.ts, L7a)
```ts
const useFakes = isTest || process.env.DUMBLEDORE_FAKES === '1'   // test-control needs the fakes
const secrets = isTest ? undefined : new SafeStorageSecretStore(paths.secretsFile)
const composition = useFakes
  ? compose({ ownPid: process.pid, secrets })
  : composeReal({
      dataDir: paths.dataDir, // one data folder for shell and engine
      secrets,
      launch: app.isPackaged ? { mode: 'packaged', mainAppBundle: resolve(process.execPath, '../../..') } : undefined,
    })
// before-quit: `void services.stop()` is enough (WAL); `composition.close()` also closes SQLite.
```

## Open issues / requests for the integrator
- L4 ↔ L7a: StudyService emits `session:changed` itself and `bridgeEvents` forwards `study.onChange` again → duplicates
  (adapter `withoutSessionEcho`). Request: drop that line from `bridgeEvents` once fakes go.
- L4 ↔ L7a: StudyService (on 'done') and SessionFlow.complete() both call `followUps.onSessionComplete` (adapter `oncePerRoadmap`).
  Request: SessionFlow stops calling it with the real engine.
- L5 ↔ L7a: the nudge engine emits `nudge:ready` and a `toast:show` copy; the overlay renders both → two toasts per nudge
  (adapter `withoutNudgeToasts`). Request: overlay ignores `toast:show` with a nudgeId, or L5 stops emitting it.
- L5 ↔ L7a: the shell's NudgeActions writes outcomes to repos directly; `FollowUpRuntime.act` (snooze timer) isn't reachable via
  `Services.followUps`. Request: add `act()` to the FollowUpService contract (available today as `composition.engine.followUps`).
- L2b: Brain has no "test provider" call → `providers.ts` runs writeNudge on a single-route `createBrain` (one tiny logged call).
  Request: a `testProvider(route)` on BrainHandle.
- L1: SocketHelperClient.start() can wait 10 s for a launched helper; composeReal caps the wait at 2 s. FakeHelper.call is O(n) in its
  call log (callIndex filter) → simulated days get quadratic; the follow-up test stops/starts the engine across the 2-day jump.
