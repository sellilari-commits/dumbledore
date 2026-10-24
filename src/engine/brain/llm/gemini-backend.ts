/**
 * Gemini backend (primary provider since 2026-10-24) on @ai-sdk/google v4.
 * - The key is passed explicitly from the KeyGetter (never GOOGLE_GENERATIVE_AI_API_KEY); without
 *   one the backend reports itself unavailable and the router skips it.
 * - Structured output uses Gemini's responseJsonSchema (full JSON Schema); coach tools become
 *   function declarations.
 * - Thinking level per tier (cost cap: thinking is billed as output): the lowest, "minimal", for
 *   triage / extract / write; "low" (moderate) for reason and chat. Without a tier the prompt's
 *   reasoning effort maps one level down. maxOutputTokens gets headroom because thinking tokens
 *   count against it; billableOutputTokens() reports that worst case to the spend cap.
 * - Gemini 3+ keeps its default temperature (Google advises against lowering it: looping).
 * - 429 / RESOURCE_EXHAUSTED → rate_limit with Google's retryDelay, so the router cools the model
 *   down and falls through; an invalid key → auth (not retried).
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { type LlmTier, PROVIDER_BASE_URLS } from '@shared/llm'
import type { LanguageModel } from 'ai'
import { type SdkCall, sdkGenerate, sdkStream } from './ai-sdk'
import { toBackendError } from './cloud-backend'
import type { KeyGetter } from './keys'
import {
  type Availability,
  type Backend,
  BackendError,
  type BackendErrorKind,
  type BackendRequest,
  type BackendResult,
  type ReasoningEffort,
  type StreamPart,
} from './types'

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

/** Chosen with the evals in docs/evals/ (lowest level that keeps quality; moderate for reason). */
export const TIER_THINKING: Record<LlmTier, ThinkingLevel> = {
  triage: 'minimal',
  extract: 'minimal',
  write: 'minimal',
  reason: 'low',
  chat: 'low',
}

/** No tier: our effort scale was tuned on gpt-oss; Gemini thinks more per level, so shift down. */
export const THINKING_LEVEL: Record<ReasoningEffort | 'none', ThinkingLevel> = {
  none: 'minimal',
  low: 'minimal',
  medium: 'low',
  high: 'medium',
}

/** Extra output tokens per thinking level (thinking tokens count against maxOutputTokens). */
const THINKING_HEADROOM: Record<ThinkingLevel, number> = {
  minimal: 512,
  low: 2048,
  medium: 4096,
  high: 8192,
}

const geminiMajor = (model: string): number => Number(/gemini-(\d+)/i.exec(model)?.[1] ?? 0)

const RETRY_DELAY = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/

function statusKind(status: number, fallback: BackendErrorKind): BackendErrorKind {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408) return 'timeout'
  if (status >= 500) return 'server'
  if (status >= 400) return 'bad_request'
  return fallback
}

/** Gemini errors → BackendError. Messages carry Google's text only (never the request or key). */
export function toGeminiError(err: unknown, signal: AbortSignal): BackendError {
  if (err instanceof BackendError) return err
  const base = toBackendError(err, signal)
  if (base.kind === 'aborted' || signal.aborted) return base
  // In-stream errors are plain objects: { message, type: 'RESOURCE_EXHAUSTED', statusCode, data }.
  const e = (err ?? {}) as Record<string, unknown>
  const streamStatus = typeof e.statusCode === 'number' ? e.statusCode : null
  const status = base.status ?? streamStatus
  let detail = ''
  try {
    detail = [e.type, e.responseBody, e.data ? JSON.stringify(e.data) : '']
      .filter((x) => typeof x === 'string')
      .join(' ')
  } catch {
    // unserialisable error data: classify on the message alone
  }
  const text = `${base.message} ${detail}`
  const extra = { status, headers: base.headers }
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(text)) {
    const m = RETRY_DELAY.exec(text)
    const retryAfterMs = base.retryAfterMs ?? (m ? Math.round(Number(m[1]) * 1000) : null)
    return new BackendError('rate_limit', base.message, {
      ...extra,
      status: status ?? 429,
      retryAfterMs,
    })
  }
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(text)) {
    return new BackendError('auth', base.message, extra)
  }
  if (base.status == null && streamStatus != null) {
    const msg = `HTTP ${streamStatus}: ${String(e.message ?? base.message)}`.slice(0, 300)
    return new BackendError(statusKind(streamStatus, base.kind), msg, extra)
  }
  return base
}

export interface GeminiBackendOptions {
  keys: KeyGetter
  fetch?: typeof globalThis.fetch
  baseURL?: string
}

export function createGeminiBackend(opts: GeminiBackendOptions): Backend {
  let cachedKey: string | undefined | null = null
  let factory: ((model: string) => LanguageModel) | null = null

  const modelFor = (model: string): LanguageModel => {
    const key = opts.keys('GEMINI_API_KEY')
    if (!key) throw new BackendError('unavailable', 'GEMINI_API_KEY not set')
    if (factory === null || key !== cachedKey) {
      cachedKey = key
      const p = createGoogleGenerativeAI({
        apiKey: key,
        baseURL: opts.baseURL ?? PROVIDER_BASE_URLS.gemini,
        fetch: opts.fetch,
      })
      factory = (m) => p.languageModel(m)
    }
    return factory(model)
  }

  const levelFor = (req: Pick<BackendRequest, 'tier' | 'reasoningEffort'>): ThinkingLevel =>
    req.tier ? TIER_THINKING[req.tier] : THINKING_LEVEL[req.reasoningEffort ?? 'none']

  const call = (req: BackendRequest): SdkCall => {
    const level = levelFor(req)
    return {
      model: modelFor(req.model),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: level } } },
      schemaMode: true,
      temperature: geminiMajor(req.model) >= 3 ? undefined : req.temperature,
      maxOutputTokens: req.maxOutputTokens + THINKING_HEADROOM[level],
      mapError: toGeminiError,
    }
  }

  return {
    provider: 'gemini',
    supportsJsonSchema: () => true,

    billableOutputTokens: (_model: string, tier: LlmTier, maxOutputTokens: number): number =>
      maxOutputTokens + THINKING_HEADROOM[TIER_THINKING[tier]],

    async availability(): Promise<Availability> {
      return opts.keys('GEMINI_API_KEY')
        ? { ok: true, reason: null }
        : { ok: false, reason: 'GEMINI_API_KEY not set' }
    },

    generate: async (req: BackendRequest): Promise<BackendResult> => sdkGenerate(req, call(req)),

    async *stream(req: BackendRequest): AsyncIterable<StreamPart> {
      yield* sdkStream(req, call(req))
    },
  }
}
