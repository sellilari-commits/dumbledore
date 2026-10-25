/**
 * Provider-neutral types for the LLM layer: one request/response shape every backend speaks
 * (Gemini, Groq, OVHcloud, Mistral through the AI SDK; Apple's on-device model through the
 * helper), and the normalised error the router uses to decide between retry, fall-through and
 * give-up.
 */
import type { LlmTier, ProviderId } from '@shared/llm'

export type JsonSchema = Record<string, unknown>

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: JsonSchema
}

export type OutputSpec =
  | { kind: 'text' }
  /** `schema: null` = plain JSON mode (json_object); otherwise the provider's JSON-schema mode. */
  | { kind: 'json'; name: string; schema: JsonSchema | null }

export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface BackendRequest {
  model: string
  system: string
  /** Conversation; the last turn is the user's prompt. */
  messages: ChatTurn[]
  output: OutputSpec
  temperature: number
  maxOutputTokens: number
  reasoningEffort: ReasoningEffort | null
  tools?: ToolDef[]
  /** 'none': the tools are listed but may not be called, so the model must answer in text. */
  toolChoice?: 'auto' | 'none'
  /** Set by the router; backends may tune to it (Gemini picks its thinking level per tier). */
  tier?: LlmTier
  signal: AbortSignal
}

export interface BackendUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface ToolCallOut {
  name: string
  input: unknown
}

export interface BackendResult {
  text: string
  usage: BackendUsage
  /** Lower-cased response headers (rate-limit info), empty when the backend has none. */
  headers: Record<string, string>
  toolCalls: ToolCallOut[]
  finishReason: string
}

export type StreamPart =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; call: ToolCallOut }
  | { type: 'finish'; usage: BackendUsage; headers: Record<string, string> }

export interface Availability {
  ok: boolean
  reason: string | null
}

export interface Backend {
  readonly provider: ProviderId
  /** Cheap check: key present, on-device model ready, … */
  availability(): Promise<Availability>
  /** Whether this model honours a JSON schema response format (else plain JSON mode is used). */
  supportsJsonSchema(model: string): boolean
  /** Most output tokens a request may be billed for, thinking included (default: the max). */
  billableOutputTokens?(model: string, tier: LlmTier, maxOutputTokens: number): number
  generate(req: BackendRequest): Promise<BackendResult>
  stream(req: BackendRequest): AsyncIterable<StreamPart>
}

export type BackendErrorKind =
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'unavailable'
  | 'aborted'

export class BackendError extends Error {
  readonly kind: BackendErrorKind
  readonly status: number | null
  readonly retryAfterMs: number | null
  readonly headers: Record<string, string>

  constructor(
    kind: BackendErrorKind,
    message: string,
    extra: {
      status?: number | null
      retryAfterMs?: number | null
      headers?: Record<string, string>
    } = {},
  ) {
    super(message)
    this.name = 'BackendError'
    this.kind = kind
    this.status = extra.status ?? null
    this.retryAfterMs = extra.retryAfterMs ?? null
    this.headers = extra.headers ?? {}
  }

  /** Worth trying again (same or next route). */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'server' ||
      this.kind === 'timeout' ||
      this.kind === 'network'
    )
  }
}

export function lowerCaseHeaders(
  h: Record<string, string> | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v
  return out
}
