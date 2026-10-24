# L2b Brain — status
Updated: 2026-10-24T16:10:00Z

## Scope
- ✅ Gemini backend (`llm/gemini-backend.ts`, @ai-sdk/google v4): explicit key, responseJsonSchema, tools, thinking level per tier, 429/RESOURCE_EXHAUSTED → rate_limit (retryDelay) → fall-through; shared SDK plumbing in `llm/ai-sdk.ts`
- ✅ Keys: DUMBLEDORE_ENV_FILES (comma-separated) read from env or `.env.local`; only GEMINI/GROQ/MISTRAL/OVH keys imported (`llm/keys.ts`)
- ✅ Spend cap: `llm/prices.ts` + `llm/spend.ts`; usage log priced → Gemini skipped as `over-budget` above DUMBLEDORE_BUDGET_EUR (default €10); `brain.spend()`
- ✅ Backends: Groq / OVHcloud (keyless) / Mistral via AI SDK v7 (`llm/cloud-backend.ts`); Apple on-device via HelperClient (`llm/apple-backend.ts`); key getter env + `.env.local` (re-read on change)
- ✅ Router (`llm/router.ts`): DEFAULT_ROUTES + Settings overrides + extra OVH fallbacks (`llm/routes.ts`); skips no-key / on-device-unavailable / Finnish-for-Apple / too-big-for-context / too-big-for-Groq-TPM / over-budget; RPM+TPM buckets with header updates (`llm/limits.ts`); retries + backoff + fall-through; deadlines; daily budgets (`llm/budget.ts`); usage logging; redact hook; streaming with pre-first-token fall-through
- ✅ Structured output (`llm/structured.ts`): zod → strict-safe JSON schema (`llm/json.ts`), JSON mode fallback, validation, one repair call with errors, soft-rule repair when time allows, 24 h cache (`llm/cache.ts`)
- ✅ Prompts P1, P3–P12 in `prompts/` (P5 includes the blind verifier)
- ✅ createBrain(deps) (`brain.ts`) + coach stream (`coach.ts`); exam batching (5/q), verifier batching, extraction chunking for on-device
- ✅ Unit tests: 124 passing, no network (`npx vitest run src/engine/brain`); tsc + biome clean
- ✅ Eval harness tools/eval-prompts.ts (+ src/engine/brain/evals/) + fixtures (extraction 30, roadmaps 8, quizzes 10×5, prompts 30); `--provider gemini`, `--max-eur` cap, estimated spend in every report
- ✅ Live Gemini evals (docs/evals/2026-10-24-*): extraction-r2 PASS (P/R 1/1, 30 eps) · prompts-r2 PASS (30; P8 v2) · roadmaps-r3 PASS (8; P3 v2) · quizzes PASS (3×5 questions, 15/15 keys confirmed). Eval spend ≈ €0.45 (conservative prices)

## Gemini settings chosen
- Thinking: minimal for triage/extract/write, low for reason/chat (`TIER_THINKING`); default temperature on Gemini 3+.
- Latency: write tier on gemini-3.5-flash p50 ≈ 1.9 s, 29/30 calls ≤ 2.5 s; roadmap ≈ 7 s; checkpoint ≈ 6.5 s; extraction batch ≈ 2.6 s.
- Prices (prices.ts): flash-lite $0.30/$2.50 verified on Google's page; gemini-3.5-flash $1.50/$9.00 UNVERIFIED (no longer listed by Google; conservative).

## Facts verified
- OVH `GET /v1/models` (2026-10-24): gpt-oss-20b, gpt-oss-120b, Qwen3.8-27B, Qwen3.6-27B, Qwen3.5-9B,
  Qwen3.5-397B-A17B, Mistral-Small-3.2-24B-Instruct-2506, Meta-Llama-3_3-70B-Instruct, Mistral-Nemo-Instruct-2407.
- OVH keyless: json_schema strict works on gpt-oss-20b; headers `x-ratelimit-remaining-minute`,
  `x-ratelimit-limit-minute`, `ratelimit-reset` (s); ~2.5–5 s latency for small requests.
- No GROQ_API_KEY / MISTRAL_API_KEY / .env.local on this machine yet.
- `tsx` does not resolve @shared/@engine with the root tsconfig.json; `--tsconfig tsconfig.node.json` works
  (the eval launcher re-execs itself that way).

## Next
1. Quizzes at full size (10 checkpoints / 50 questions) when budget allows (~€0.11).
2. Split router.ts (≈520 lines) — e.g. stream() into its own module.

## Open issues / requests for the integrator
- Brain contract: add `spend(): { eur, capEur }` (exists on BrainHandle); show it in Settings → usage.
- DEFAULT_ROUTES: consider gemini-3.5-flash-lite for `write` (flash p90 ≈ 2.4 s vs the 2.5 s budget), and moving off gemini-3.5-flash (gone from Google's pricing page; 3.6 Flash is $0.75/$3.75 until 2026-12-31).
- docs/PLAN.md §3.3 / §6.5 still describe Groq as primary and Gemini as ruled out.
- writeStep rejects with BrainTimeoutError after 2.5 s (contract); callers fall back to the step's promptDraft.
- P10 tools `remember` / `schedule_review` from the plan have no CoachAction type; not exposed.
- Verifier routes on tier `extract` but never on-device (3B model too weak to judge keys).
