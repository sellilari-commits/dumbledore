# L3 Perception — status
Updated: 2026-10-24T18:52:00+03:00

## Scope
- ✅ Privacy: blocklists (apps, hosts, private windows), `isBlocked`/`blockReason`, `redact` (+ tests) — src/engine/privacy
- ✅ AI-chat detector + tracker (all 8 assistants, text markers, placeholders) — perception/ai-chat
- ✅ Capture scheduler (§6.4 cadence, idle/lock/low power, pre-capture privacy check, visible every 3rd tick) — perception/scheduler.ts, local ScriptedHelper in perception/testing
- ✅ Episode builder (keys, dwell, order-preserving scroll merge, 8 s switch / pause / 3 min checkpoint, boilerplate, kind, source, signals, NowContext, chat/page context) — perception/episodes
- ✅ PerceptionService (start/stop/setEnabled/isActive/now/aiChat/chatExcerpt/pageContext + checkpointChat/linkSubject) — perception/service.ts; `createPerceptionStack` wires perception + worker — perception/stack.ts
- ✅ Prefilter + extraction worker (batching ≤3/token cap, 2 min flush, urgent chat flush in sessions, daily budget, apply to Repos, retention purge) — perception/extraction
- ✅ Fixtures: 7 recorded scenarios in tests/fixtures/episodes (Wikipedia + scroll-backs, scanned PDF via OCR, ChatGPT with aligned lines, Moodle assignment with due date, Spotify + news, 1Password, Incognito); loader/replay/fixture extractor in perception/testing/fixtures.ts
- ✅ Pipeline test (perception/pipeline.test.ts): frames → episodes → prefilter → FakeBrain.extract → encounters/concepts/assignments/habits in createMemoryRepos; blocked windows leave no trace in helper replies, bus events, LLM input or DB
- ✅ Fixes found by the pipeline test:
  - scroll-backs: chrome pinned to the bottom (chat input bar, footer) is ignored, and page turns / jumps compare first-seen order, so a new chat reply or the next slide no longer counts as re-reading
  - merge: a page turn behind a fixed title line (slides, PDF pages) continues after the page that was on screen instead of being inserted before it

## Done
All items finished. `npx vitest run src/engine/perception src/engine/privacy`: 12 files, 157 tests green. tsc (node project): 0 errors in perception/privacy. Biome: clean.

## Integration (composition root)
```ts
const stack = createPerceptionStack({
  helper,            // HelperClient (engine/helper)
  repos,             // Repos (SQLite)
  bus,               // EngineBus
  brain,             // Pick<Brain, 'extract'>
  clock,             // optional, default systemClock
  isLowPower,        // optional () => boolean (macOS Low Power Mode)
  log,               // optional (message, error?) => void
  mastery,           // optional MasteryModel | null (encounters update mastery)
  workerOptions,     // optional Partial<WorkerOptions>
  episodeOptions,    // optional Partial<EpisodeOptions>
})
stack.start()        // after the helper is started; stack.stop() on quit (closes open episodes first)
stack.perception     // the PerceptionService for the rest of the engine
```
- Listens on the bus: `settings:changed`, `helper:status`, `helper:appActivated`, `helper:screenLocked` (the shell forwards helper events), `session:changed` (urgent chat extraction).
- Emits: `perception:window`, `perception:episodeClosed`, `perception:now`, `perception:aiChat`, `memory:changed`.
- Capture runs only while `settings.captureEnabled` and `perception.setEnabled(true)` (default true).

## Open issues / requests for the integrator
- (none)
