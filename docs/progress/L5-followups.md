# L5 Follow-ups — status
Updated: 2026-10-24T15:11:35Z

## Scope
- ✅ Read plan + contracts; module layout decided (see below)
- ✅ MasteryModel: mastery math, status thresholds, Leitner boxes, deadline pull-in + ramp-up (`learning/mastery`, 22 tests)
- ✅ QuizService: get / answer / finish (score, byConcept, mastery, gaps + fallback, checkpoint callback) (`learning/quiz`)
- ✅ QuizService: createExam (background, focus selection, ≤5-question batches, verify + regenerate ≤2 tries or drop, recoverInterrupted)
- ✅ QuizService: startReview (≤8 concepts, ≥3 questions, question-bank fallback) — quiz tests: 26 green
- ✅ Natural-break / receptivity detector (`scheduler/receptivity.ts`, app-classes.ts, local-time.ts; 11 tests)
- ✅ Nudge engine: candidates, policy (caps, gap, quiet hours, fatigue, dedupe), text (Brain + templates), show/act/expire/snooze (`scheduler/`; policy/text 8, candidates 10, engine 9 tests)
- ✅ Profile builder (daily Brain.buildProfile, keep previous on failure, 2 h retry; 4 tests)
- ✅ FollowUpService: start/stop (5-min check + break/snooze-triggered checks), onSessionComplete, dueSummary, act, recovery of recent follow-ups (`learning/followup`; 7 multi-day tests)
- ✅ Multi-day FakeClock tests; vitest (12 files, 97 tests) + tsc + biome clean on lane paths

## Layout
- `learning/mastery/`: mastery-math.ts (pure), mastery-model.ts (MasteryModel + deadline ramp)
- `learning/quiz/`: quiz-service.ts, quiz-results.ts, exam-builder.ts, review-builder.ts, verify.ts, drafts.ts
- `learning/followup/`: followup-service.ts (wires scheduler pieces; implements FollowUpService)
- `scheduler/`: local-time.ts, app-classes.ts, receptivity.ts, nudge-policy.ts, nudge-common.ts,
  nudge-candidates.ts, nudge-anchors.ts, nudge-text.ts, nudge-engine.ts, profile-builder.ts

## Next
1. Final review pass + report. (All scope items done.)

## Open issues / requests for the integrator
- FakeBrain gives every question on a concept the same stem; quiz de-duplication (by stem) then shrinks
  FakeBrain exams/reviews. Tests use `variedBrain()` (quiz/quiz-fixtures.ts). Request: make FakeBrain
  stems unique per index so the UI demo / e2e-sim get full-size exams.
- Request (contract): `ExamInput.avoidStems: string[]` so later 5-question batches don't repeat earlier
  ones (each batch currently sees the same concepts; only exact repeats are filtered).
