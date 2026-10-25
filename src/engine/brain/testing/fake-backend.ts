/**
 * Scripted Backend for unit tests: queue replies (text, errors, delays) or install a handler;
 * every request is recorded. Delays honour the request's abort signal like a real HTTP call.
 */
import type { LlmTier, ProviderId } from '@shared/llm'
import { TimeoutReason } from '../llm/cloud-backend'
import {
  type Availability,
  type Backend,
  BackendError,
  type BackendRequest,
  type BackendResult,
  type SourceLink,
  type StreamPart,
  type ToolCallOut,
} from '../llm/types'

export interface FakeReplyData {
  text?: string
  json?: unknown
  toolCalls?: ToolCallOut[]
  usage?: { inputTokens: number | null; outputTokens: number | null }
  headers?: Record<string, string>
  finishReason?: string
  error?: BackendError
  delayMs?: number
  /** For stream(): text chunks to emit before the tool calls. */
  chunks?: string[]
  /** For generate() on a grounded request: the pages the answer drew on. */
  sources?: SourceLink[]
}
export type FakeReply = FakeReplyData | ((req: BackendRequest) => FakeReplyData)

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(
        signal.reason instanceof TimeoutReason
          ? new BackendError('timeout', 'request timed out')
          : new BackendError('aborted', 'request cancelled'),
      )
    if (signal.aborted) return fail()
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      fail()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class FakeBackend implements Backend {
  readonly requests: BackendRequest[] = []
  private readonly replies: FakeReply[] = []
  available: Availability = { ok: true, reason: null }
  jsonSchema = true
  /** Used when the queue is empty. */
  fallback: FakeReply | null = null
  /** Optional worst-case billed output (thinking), like the Gemini backend reports. */
  billableOutputTokens?: (model: string, tier: LlmTier, maxOutputTokens: number) => number

  constructor(
    readonly provider: ProviderId,
    ...replies: FakeReply[]
  ) {
    this.replies.push(...replies)
  }

  queue(...replies: FakeReply[]): this {
    this.replies.push(...replies)
    return this
  }

  async availability(): Promise<Availability> {
    return this.available
  }

  supportsJsonSchema(): boolean {
    return this.jsonSchema
  }

  private next(req: BackendRequest): FakeReplyData {
    this.requests.push(req)
    const r = this.replies.shift() ?? this.fallback
    if (!r) throw new Error(`FakeBackend(${this.provider}): no reply queued`)
    return typeof r === 'function' ? r(req) : r
  }

  async generate(req: BackendRequest): Promise<BackendResult> {
    const r = this.next(req)
    if (r.delayMs) await wait(r.delayMs, req.signal)
    if (r.error) throw r.error
    return {
      text: r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : ''),
      usage: r.usage ?? { inputTokens: 100, outputTokens: 50 },
      headers: r.headers ?? {},
      toolCalls: r.toolCalls ?? [],
      finishReason: r.finishReason ?? 'stop',
      ...(r.sources ? { sources: r.sources } : {}),
    }
  }

  async *stream(req: BackendRequest): AsyncIterable<StreamPart> {
    const r = this.next(req)
    if (r.delayMs) await wait(r.delayMs, req.signal)
    if (r.error) throw r.error
    for (const delta of r.chunks ?? (r.text ? [r.text] : [])) yield { type: 'text', delta }
    for (const call of r.toolCalls ?? []) yield { type: 'tool-call', call }
    yield {
      type: 'finish',
      usage: r.usage ?? { inputTokens: 100, outputTokens: 50 },
      headers: r.headers ?? {},
    }
  }
}
