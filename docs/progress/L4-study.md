# L4 Study — status
Updated: 2026-10-24T18:45:00Z

## Scope
- ✅ Foundations: deps/options, text utils, clock-based deadline (`withDeadline`)
- ✅ materialize (plan → Roadmap, "Checkpoint N · k questions", final checkpoint enforced, default draft) · roadmap-ops (advance, carry-over, recent misses, summary)
- ✅ Context assembly for buildRoadmap (`context.ts`) · cold-start subject resolver (`subject-resolver.ts`) · planner (`planner.ts`)
- ✅ Step writer w/ 2.5 s fallback + move tips · memory updates → encounters/concepts/MasteryModel
- ✅ Checkpoint quiz: generation + verifier / regenerate (2 tries) / drop · prefetch cache (immediate, or delayed with a live chat feed)
- ✅ Picker ranking + SubjectSummary (`picker.ts`)
- ✅ StudyServiceImpl (start/next/pause/end/current/onChange/handleCheckpointResult, restart rebuild)
- ✅ PromptService (suggest/improve + fallbacks)
- ✅ Tests: 54 green in 6 files; tsc 0 errors in lane; biome clean
- ✅ Final review pass

## Next
1. Integration (I2): wire deps as below; e2e on mock chat page.

## Open issues / requests for the integrator
- Wiring: `createStudyService({ repos, brain, clock, bus, mastery, followUp, chatExcerpt: (n) => perception.chatExcerpt(n) })`;
  `quizService.setCheckpointHandler((id, r) => study.handleCheckpointResult(id, r))`;
  `createPromptService({ repos, brain, clock, session: () => study.current() })`.
- `next()` throws StudyError when no session exists; start()/next() throw StudyError on planning failure / quiz failure (session state already updated) — the shell shows the toast.
- 'quiz:open' is emitted whenever a quiz instruction is returned (also on re-open) — handle idempotently.
- pause()/end() set roadmap.status 'paused'; Home "Continue" should list non-done roadmaps (getActive semantics), not only listActive().
- No contract changes or new deps needed.
