/**
 * Shared Vercel AI SDK v7 plumbing for the cloud backends (Gemini, Groq, OVHcloud, Mistral):
 * BackendRequest → generateText / streamText (messages, tools, JSON output), results →
 * BackendResult / StreamPart, errors → BackendError through a provider-specific mapper. SDK
 * retries are off (the router owns retries); unparseable JSON comes back as text for repair.
 * Output token counts always include thinking/reasoning tokens (they are billed as output).
 */
import {
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
import {
  type BackendError,
  type BackendRequest,
  type BackendResult,
  type BackendUsage,
  lowerCaseHeaders,
  type StreamPart,
} from './types'

export type JSONValue =
  | null
  | string
  | number
  | boolean
  | JSONValue[]
  | { [key: string]: JSONValue }
export type ProviderOpts = Record<string, Record<string, JSONValue>>

/** Provider-specific settings for one SDK call. */
export interface SdkCall {
  model: LanguageModel
  providerOptions: ProviderOpts
  /** Send the JSON schema (provider schema mode) rather than plain JSON mode. */
  schemaMode: boolean
  /** `undefined` = the provider's default temperature. */
  temperature: number | undefined
  maxOutputTokens: number
  mapError: (err: unknown, signal: AbortSignal) => BackendError
}

interface SdkUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  outputTokenDetails?: { textTokens?: number | undefined; reasoningTokens?: number | undefined }
}

/** Usage with reasoning tokens counted as output even if a provider leaves them out of the total. */
export function toUsage(u: SdkUsage | undefined): BackendUsage {
  const total = u?.outputTokens
  const text = u?.outputTokenDetails?.textTokens
  const reasoning = u?.outputTokenDetails?.reasoningTokens ?? 0
  const parts = text != null ? text + reasoning : null
  const out = total == null ? parts : parts == null ? total : Math.max(total, parts)
  return { inputTokens: u?.inputTokens ?? null, outputTokens: out }
}

const messages = (req: BackendRequest): ModelMessage[] =>
  req.messages.map((m) => ({ role: m.role, content: m.content }))

function tools(req: BackendRequest): Record<string, Tool> | undefined {
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

function output(req: BackendRequest, schemaMode: boolean) {
  if (req.output.kind !== 'json') return undefined
  if (req.output.schema && schemaMode) {
    return Output.object({ schema: jsonSchema(req.output.schema as never), name: req.output.name })
  }
  return Output.json({ name: req.output.name })
}

export async function sdkGenerate(req: BackendRequest, c: SdkCall): Promise<BackendResult> {
  try {
    const result = await generateText({
      model: c.model,
      instructions: req.system,
      messages: messages(req),
      temperature: c.temperature,
      maxOutputTokens: c.maxOutputTokens,
      maxRetries: 0,
      abortSignal: req.signal,
      output: output(req, c.schemaMode),
      tools: tools(req),
      providerOptions: c.providerOptions,
    })
    return {
      text: result.text,
      usage: toUsage(result.usage),
      headers: lowerCaseHeaders(result.response.headers),
      toolCalls: result.toolCalls.map((x) => ({ name: x.toolName, input: x.input })),
      finishReason: result.finishReason,
    }
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // The model answered but not with parseable JSON: hand the text back for repair.
      return {
        text: err.text ?? '',
        usage: toUsage(err.usage),
        headers: lowerCaseHeaders(err.response?.headers),
        toolCalls: [],
        finishReason: err.finishReason ?? 'unknown',
      }
    }
    throw c.mapError(err, req.signal)
  }
}

export async function* sdkStream(req: BackendRequest, c: SdkCall): AsyncIterable<StreamPart> {
  let headers: Record<string, string> = {}
  try {
    const result = streamText({
      model: c.model,
      instructions: req.system,
      messages: messages(req),
      temperature: c.temperature,
      maxOutputTokens: c.maxOutputTokens,
      maxRetries: 0,
      abortSignal: req.signal,
      tools: tools(req),
      providerOptions: c.providerOptions,
    })
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        if (part.text) yield { type: 'text', delta: part.text }
      } else if (part.type === 'tool-call') {
        yield { type: 'tool-call', call: { name: part.toolName, input: part.input } }
      } else if (part.type === 'finish-step') {
        headers = lowerCaseHeaders(part.response.headers)
      } else if (part.type === 'error') {
        throw c.mapError(part.error, req.signal)
      } else if (part.type === 'abort') {
        throw c.mapError(new Error('aborted'), req.signal)
      } else if (part.type === 'finish') {
        yield {
          type: 'finish',
          usage: toUsage(part.totalUsage),
          headers,
        }
      }
    }
  } catch (err) {
    throw c.mapError(err, req.signal)
  }
}
