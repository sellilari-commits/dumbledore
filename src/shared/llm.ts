/**
 * LLM routing configuration shared by the engine and the Settings page.
 *
 * Model ids were checked against the providers' docs on 2026-10-24 (see docs/PLAN.md §3.3).
 * Preview models disappear quickly, so every id here can be overridden in Settings, and the
 * router falls through the list in order.
 */
import { z } from 'zod'

export const LlmTier = z.enum(['triage', 'extract', 'reason', 'write', 'chat'])
export type LlmTier = z.infer<typeof LlmTier>

export const ProviderId = z.enum(['gemini', 'apple', 'groq', 'ovh', 'mistral'])
export type ProviderId = z.infer<typeof ProviderId>

export const ModelRoute = z.object({ provider: ProviderId, model: z.string() })
export type ModelRoute = z.infer<typeof ModelRoute>

/**
 * Gemini 3.5 is primary (decided 2026-10-24): it runs on the paid key of the Hugo project,
 * so the paid-service terms apply (no training on prompts). Development reads GEMINI_API_KEY
 * from the file named in DUMBLEDORE_ENV_FILES (see .env.example); the key is never copied.
 */
export const DEFAULT_ROUTES: Record<LlmTier, ModelRoute[]> = {
  triage: [
    { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
    { provider: 'apple', model: 'system' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
  ],
  extract: [
    { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
    { provider: 'apple', model: 'system' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'mistral', model: 'ministral-8b-2512' },
  ],
  reason: [
    { provider: 'gemini', model: 'gemini-3.5-flash' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    { provider: 'ovh', model: 'gpt-oss-120b' },
    { provider: 'mistral', model: 'mistral-small-2603' },
  ],
  write: [
    { provider: 'gemini', model: 'gemini-3.5-flash' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
  ],
  chat: [
    { provider: 'gemini', model: 'gemini-3.5-flash' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'ovh', model: 'gpt-oss-120b' },
  ],
}

export const PROVIDER_BASE_URLS: Record<Exclude<ProviderId, 'apple'>, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  ovh: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
  mistral: 'https://api.mistral.ai/v1',
}

/** Free-tier limits per model (null = unknown / not published). */
export interface ProviderLimits {
  requestsPerMinute: number | null
  requestsPerDay: number | null
  tokensPerMinute: number | null
  tokensPerDay: number | null
  contextTokens: number | null
}

export const PROVIDER_LIMITS: Record<ProviderId, ProviderLimits> = {
  gemini: {
    requestsPerMinute: 1000, // paid tier; real limits come back in quota errors
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    contextTokens: 1_048_576,
  },
  apple: {
    requestsPerMinute: null,
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    contextTokens: 4096,
  },
  groq: {
    requestsPerMinute: 30,
    requestsPerDay: 1000,
    tokensPerMinute: 8000,
    tokensPerDay: 200_000,
    contextTokens: 131_072,
  },
  ovh: {
    requestsPerMinute: 2, // anonymous, per IP per model
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    contextTokens: 131_072,
  },
  mistral: {
    requestsPerMinute: null,
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    contextTokens: 128_000,
  },
}

/** Human names of the AI chat assistants the student uses (what the step prompts address). */
export const ASSISTANT_NAMES = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  mistral: 'Le Chat',
  deepseek: 'DeepSeek',
  grok: 'Grok',
} as const
export type AssistantKey = keyof typeof ASSISTANT_NAMES
