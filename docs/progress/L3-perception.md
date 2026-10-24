# L3 Perception — status
Updated: 2026-10-24T18:08:00Z

## Scope
- ✅ Privacy: blocklists (apps, hosts, private windows), `isBlocked`/`blockReason`, `redact` (+ tests) — src/engine/privacy
- ✅ AI-chat detector + tracker (all 8 assistants, text markers, placeholders) — perception/ai-chat
- ✅ Capture scheduler (§6.4 cadence, idle/lock/low power, pre-capture privacy check, visible every 3rd tick) — perception/scheduler.ts, local ScriptedHelper in perception/testing
- ✅ Episode builder (keys, dwell, order-preserving scroll merge, 8 s switch / pause / 3 min checkpoint, boilerplate, kind, source, signals, NowContext, chat/page context) — perception/episodes
- ✅ PerceptionService (start/stop/setEnabled/isActive/now/aiChat/chatExcerpt/pageContext + checkpointChat/linkSubject) — perception/service.ts; `createPerceptionStack` wires perception + worker — perception/stack.ts
- ✅ Prefilter + extraction worker (batching ≤3/token cap, 2 min flush, urgent chat flush in sessions, daily budget, apply to Repos, retention purge) — perception/extraction
- 🚧 Fixtures (tests/fixtures/episodes) + pipeline test — writing now

## Next
1. fixtures (7 JSON files) + loader (perception/testing/fixtures.ts) + pipeline.test.ts
2. final tsc/biome pass, report

## Open issues / requests for the integrator
- (none yet)
