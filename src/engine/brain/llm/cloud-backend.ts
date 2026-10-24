/**
 * Cloud backends (Groq, OVHcloud AI Endpoints, Mistral) on the Vercel AI SDK v7. One request in,
 * raw text + usage + rate-limit headers out; the router owns retries (SDK retries are off), and
 * structured output is parsed/validated by the caller so a failed parse can be repaired.
 */
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { PROVIDER_BASE_URLS } from '@shared/llm'
import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  streamText,
  type Tool,
  tool,
} from 'ai'
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
type JSONValue = null | string | number | boolean | JSONValue[] | { [key: string]: JSONValue }
type ProviderOpts = Record<string, Record<string, JSONValue>>

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

  const messages = (req: BackendRequest): ModelMessage[] =>
    req.messages.map((m) => ({ role: m.role, content: m.content }))

  const tools = (req: BackendRequest): Record<string, Tool> | undefined => {
    if (!req.tools?.length) return undefined
    const out: Record<string, Tool> = {}
    for (const t of req.tools) {
      out[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters as never),
      })
    }
    return out
  }

  const output = (req: BackendRequest) => {
    if (req.output.kind !== 'json') return undefined
    if (req.output.schema && supportsJsonSchema(req.model)) {
      return Output.object({
        schema: jsonSchema(req.output.schema as never),
        name: req.output.name,
      })
    }
    return Output.json({ name: req.output.name })
  }

  function supportsJsonSchema(model: string): boolean {
    if (provider === 'groq') return /gpt-oss|kimi|llama-4/i.test(model)
    return true
  }

  return {
    provider,
    supportsJsonSchema,

    async availability(): Promise<Availability> {
      if (provider === 'ovh') return { ok: true, reason: null }
      return opts.keys(keyName)
        ? { ok: true, reason: null }
        : { ok: false, reason: `${keyName} not set` }
    },

    async generate(req: BackendRequest): Promise<BackendResult> {
      try {
        const result = await generateText({
          model: modelFor(req.model),
          instructions: req.system,
          messages: messages(req),
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          maxRetries: 0,
          abortSignal: req.signal,
          output: output(req),
          tools: tools(req),
          providerOptions: providerOptions(req),
        })
        return {
          text: result.text,
          usage: {
            inputTokens: result.usage.inputTokens ?? null,
            outputTokens: result.usage.outputTokens ?? null,
          },
          headers: lowerCaseHeaders(result.response.headers),
          toolCalls: result.toolCalls.map((c) => ({ name: c.toolName, input: c.input })),
          finishReason: result.finishReason,
        }
      } catch (err) {
        if (NoObjectGeneratedError.isInstance(err)) {
          // The model answered but not with parseable JSON: hand the text back for repair.
          return {
            text: err.text ?? '',
            usage: {
              inputTokens: err.usage?.inputTokens ?? null,
              outputTokens: err.usage?.outputTokens ?? null,
            },
            headers: lowerCaseHeaders(err.response?.headers),
            toolCalls: [],
            finishReason: err.finishReason ?? 'unknown',
          }
        }
        throw toBackendError(err, req.signal)
      }
    },

    async *stream(req: BackendRequest): AsyncIterable<StreamPart> {
      let headers: Record<string, string> = {}
      try {
        const result = streamText({
          model: modelFor(req.model),
          instructions: req.system,
          messages: messages(req),
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          maxRetries: 0,
          abortSignal: req.signal,
          tools: tools(req),
          providerOptions: providerOptions(req),
        })
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            if (part.text) yield { type: 'text', delta: part.text }
          } else if (part.type === 'tool-call') {
            yield { type: 'tool-call', call: { name: part.toolName, input: part.input } }
          } else if (part.type === 'finish-step') {
            headers = lowerCaseHeaders(part.response.headers)
          } else if (part.type === 'error') {
            throw toBackendError(part.error, req.signal)
          } else if (part.type === 'abort') {
            throw toBackendError(new Error('aborted'), req.signal)
          } else if (part.type === 'finish') {
            yield {
              type: 'finish',
              usage: {
                inputTokens: part.totalUsage.inputTokens ?? null,
                outputTokens: part.totalUsage.outputTokens ?? null,
              },
              headers,
            }
          }
        }
      } catch (err) {
        throw toBackendError(err, req.signal)
      }
    },
  }
}
