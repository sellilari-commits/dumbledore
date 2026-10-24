/**
 * Cloud backends (Groq, OVHcloud AI Endpoints, Mistral) on the Vercel AI SDK v7. One request in,
 * raw text + usage + rate-limit headers out; the router owns retries (SDK retries are off), and
 * structured output is parsed/validated by the caller so a failed parse can be repaired. Also
 * home of the shared HTTP error mapping (toBackendError) used by every cloud backend and the
 * router. Gemini lives in gemini-backend.ts; the SDK call itself in ai-sdk.ts.
 */
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { PROVIDER_BASE_URLS } from '@shared/llm'
import { APICallError, type LanguageModel } from 'ai'
import { type JSONValue, type ProviderOpts, type SdkCall, sdkGenerate, sdkStream } from './ai-sdk'
import type { KeyGetter, KeyName } from './keys'
import { parseDuration } from './limits'
import {
  type Availability,
  type Backend,
  BackendError,
  type BackendRequest,
  type BackendResult,
  lowerCaseHeaders,
  type StreamPart,
} from './types'

export type CloudProvider = 'groq' | 'ovh' | 'mistral'

type FetchFn = typeof globalThis.fetch

const KEY_NAMES: Record<CloudProvider, KeyName> = {
  groq: 'GROQ_API_KEY',
  ovh: 'OVH_AI_ENDPOINTS_TOKEN',
  mistral: 'MISTRAL_API_KEY',
}

const isGptOss = (model: string) => /gpt-oss/i.test(model)
const isQwen = (model: string) => /qwen/i.test(model)

/** Thrown by an aborted signal; `reason` tells our timeout apart from a caller's cancel. */
export class TimeoutReason extends Error {
  constructor() {
    super('timeout')
    this.name = 'TimeoutReason'
  }
}

export function toBackendError(err: unknown, signal: AbortSignal): BackendError {
  if (err instanceof BackendError) return err
  if (signal.aborted) {
    return signal.reason instanceof TimeoutReason
      ? new BackendError('timeout', 'request timed out')
      : new BackendError('aborted', 'request cancelled')
  }
  if (APICallError.isInstance(err)) {
    const headers = lowerCaseHeaders(err.responseHeaders)
    const status = err.statusCode ?? null
    const retryAfterMs =
      parseDuration(headers['retry-after-ms'] ? `${headers['retry-after-ms']}ms` : undefined) ??
      parseDuration(headers['retry-after'])
    const msg = `HTTP ${status ?? '?'}: ${err.message}`.slice(0, 300)
    const extra = { status, retryAfterMs, headers }
    if (status === 429) return new BackendError('rate_limit', msg, extra)
    if (status === 401 || status === 403) return new BackendError('auth', msg, extra)
    if (status === 408) return new BackendError('timeout', msg, extra)
    if (status != null && status >= 500) return new BackendError('server', msg, extra)
    if (status != null && status >= 400) return new BackendError('bad_request', msg, extra)
    return new BackendError(err.isRetryable ? 'server' : 'bad_request', msg, extra)
  }
  const e = err as { name?: string; message?: string }
  if (e?.name === 'AbortError') return new BackendError('timeout', 'request aborted')
  if (
    e?.name === 'TypeError' ||
    /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(e?.message ?? '')
  ) {
    return new BackendError('network', (e?.message ?? 'network error').slice(0, 300))
  }
  return new BackendError('server', (e?.message ?? String(err)).slice(0, 300))
}

export interface CloudBackendOptions {
  keys: KeyGetter
  fetch?: FetchFn
}

export function createCloudBackend(provider: CloudProvider, opts: CloudBackendOptions): Backend {
  const keyName = KEY_NAMES[provider]
  let cachedKey: string | undefined | null = null
  let factory: ((model: string) => LanguageModel) | null = null

  const modelFor = (model: string): LanguageModel => {
    const key = opts.keys(keyName)
    if (factory === null || key !== cachedKey) {
      cachedKey = key
      if (provider === 'groq') {
        const p = createGroq({ apiKey: key, fetch: opts.fetch })
        factory = (m) => p.languageModel(m)
      } else if (provider === 'mistral') {
        const p = createMistral({ apiKey: key, fetch: opts.fetch })
        factory = (m) => p.languageModel(m)
      } else {
        const p = createOpenAICompatible({
          name: 'ovh',
          baseURL: PROVIDER_BASE_URLS.ovh,
          apiKey: key,
          supportsStructuredOutputs: true,
          includeUsage: true,
          fetch: opts.fetch,
        })
        factory = (m) => p.chatModel(m)
      }
    }
    return factory(model)
  }

  const providerOptions = (req: BackendRequest): ProviderOpts => {
    const effort = req.reasoningEffort
    if (provider === 'groq') {
      const o: Record<string, JSONValue> = { strictJsonSchema: isGptOss(req.model) }
      if (isGptOss(req.model) && effort) o.reasoningEffort = effort
      if (isQwen(req.model)) o.reasoningFormat = 'hidden'
      if (req.tools?.length) o.parallelToolCalls = false
      return { groq: o }
    }
    if (provider === 'ovh') {
      const o: Record<string, JSONValue> = {}
      // OVHcloud rejects extra body fields such as chat_template_kwargs (HTTP 400, verified).
      if (isGptOss(req.model) && effort) o.reasoningEffort = effort
      return { ovh: o }
    }
    return { mistral: { structuredOutputs: true, strictJsonSchema: false } }
  }

  function supportsJsonSchema(model: string): boolean {
    if (provider === 'groq') return /gpt-oss|kimi|llama-4/i.test(model)
    return true
  }

  const call = (req: BackendRequest): SdkCall => ({
    model: modelFor(req.model),
    providerOptions: providerOptions(req),
    schemaMode: supportsJsonSchema(req.model),
    temperature: req.temperature,
    maxOutputTokens: req.maxOutputTokens,
    mapError: toBackendError,
  })

  return {
    provider,
    supportsJsonSchema,

    async availability(): Promise<Availability> {
      if (provider === 'ovh') return { ok: true, reason: null }
      return opts.keys(keyName)
        ? { ok: true, reason: null }
        : { ok: false, reason: `${keyName} not set` }
    },

    generate: (req: BackendRequest): Promise<BackendResult> => sdkGenerate(req, call(req)),

    stream: (req: BackendRequest): AsyncIterable<StreamPart> => sdkStream(req, call(req)),
  }
}
