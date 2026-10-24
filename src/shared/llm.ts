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

export const ProviderId = z.enum(['apple', 'groq', 'ovh', 'mistral'])
export type ProviderId = z.infer<typeof ProviderId>

export const ModelRoute = z.object({ provider: ProviderId, model: z.string() })
export type ModelRoute = z.infer<typeof ModelRoute>

export const DEFAULT_ROUTES: Record<LlmTier, ModelRoute[]> = {
  triage: [
    { provider: 'apple', model: 'system' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
  ],
  extract: [
    { provider: 'apple', model: 'system' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'mistral', model: 'ministral-8b-2512' },
  ],
  reason: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    { provider: 'ovh', model: 'gpt-oss-120b' },
    { provider: 'mistral', model: 'mistral-small-2603' },
  ],
  write: [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    { provider: 'ovh', model: 'gpt-oss-20b' },
  ],
  chat: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'ovh', model: 'gpt-oss-120b' },
  ],
}

export const PROVIDER_BASE_URLS: Record<Exclude<ProviderId, 'apple'>, string> = {
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
