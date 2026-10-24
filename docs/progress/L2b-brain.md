# L2b Brain — status
Updated: 2026-10-24T15:05:00Z

## Scope
- ✅ Backends: Groq / OVHcloud (keyless) / Mistral via AI SDK v7 (`llm/cloud-backend.ts`); Apple on-device via HelperClient (`llm/apple-backend.ts`); key getter env + `.env.local` (re-read on change)
- ✅ Router (`llm/router.ts`): DEFAULT_ROUTES + Settings overrides + extra OVH fallbacks (`llm/routes.ts`); skips no-key / on-device-unavailable / Finnish-for-Apple / too-big-for-context / too-big-for-Groq-TPM / over-budget; RPM+TPM buckets with header updates (`llm/limits.ts`); retries + backoff + fall-through; deadlines; daily budgets (`llm/budget.ts`); usage logging; redact hook; streaming with pre-first-token fall-through
- ✅ Structured output (`llm/structured.ts`): zod → strict-safe JSON schema (`llm/json.ts`), JSON mode fallback, validation, one repair call with errors, soft-rule repair when time allows, 24 h cache (`llm/cache.ts`)
- ✅ Prompts P1, P3–P12 in `prompts/` (P5 includes the blind verifier)
- ✅ createBrain(deps) (`brain.ts`) + coach stream (`coach.ts`); exam batching (5/q), verifier batching, extraction chunking for on-device
- ✅ Unit tests: 98 passing (`npx vitest run src/engine/brain`)
- ⬜ Eval harness tools/eval-prompts.ts + fixtures (extraction 30, roadmaps 8, quizzes 10×5, prompts 30)
- ⬜ Live eval runs recorded in docs/evals/

## Facts verified
- OVH `GET /v1/models` (2026-10-24): gpt-oss-20b, gpt-oss-120b, Qwen3.8-27B, Qwen3.6-27B, Qwen3.5-9B,
  Qwen3.5-397B-A17B, Mistral-Small-3.2-24B-Instruct-2506, Meta-Llama-3_3-70B-Instruct, Mistral-Nemo-Instruct-2407.
- OVH keyless: json_schema strict works on gpt-oss-20b; headers `x-ratelimit-remaining-minute`,
  `x-ratelimit-limit-minute`, `ratelimit-reset` (s); ~2.5–5 s latency for small requests.
- No GROQ_API_KEY / MISTRAL_API_KEY / .env.local on this machine yet.
- `tsx` does not resolve @shared/@engine with the root tsconfig.json; `--tsconfig tsconfig.node.json` works
  (the eval launcher re-execs itself that way).

## Next
1. Fixtures + eval harness (logic in src/engine/brain/evals/, launcher tools/eval-prompts.ts).
2. Live runs on OVHcloud (2 req/min/model), iterate prompts, record docs/evals/2026-10-24-*.md.

## Open issues / requests for the integrator
- writeStep rejects with BrainTimeoutError after 2.5 s (contract); callers fall back to the step's promptDraft.
- P10 tools `remember` / `schedule_review` from the plan have no CoachAction type; not exposed.
- Verifier routes on tier `extract` but never on-device (3B model too weak to judge keys).
