/**
 * Apple's on-device model, reached through the Swift helper ('llm.onDevice.status' /
 * 'llm.onDevice.generate'). Schema-guided JSON only, ~4K-token context, English (not Finnish);
 * the router decides what may come here. Status is cached briefly so routing stays cheap.
 */
import type { Clock } from '../../clock'
import type { HelperClient } from '../../contracts'
import {
  type Availability,
  type Backend,
  BackendError,
  type BackendRequest,
  type BackendResult,
  type StreamPart,
} from './types'

export interface AppleBackendOptions {
  helper: HelperClient | null
  clock: Clock
  /** How long a status answer is trusted (default 60 s). */
  statusTtlMs?: number
  /** Settings switch (`settings.ai.useOnDevice`); read on every check. */
  enabled?: () => boolean
}

export function createAppleBackend(opts: AppleBackendOptions): Backend {
  const ttl = opts.statusTtlMs ?? 60_000
  let cached: { at: number; value: Availability } | null = null

  const availability = async (): Promise<Availability> => {
    if (opts.enabled && !opts.enabled())
      return { ok: false, reason: 'on-device model switched off' }
    const helper = opts.helper
    if (!helper) return { ok: false, reason: 'no helper' }
    if (helper.status !== 'connected') return { ok: false, reason: `helper ${helper.status}` }
    const now = opts.clock.now()
    if (cached && now - cached.at < ttl) return cached.value
    let value: Availability
    try {
      const s = await helper.call('llm.onDevice.status', {}, { timeoutMs: 2000 })
      value = s.available
        ? { ok: true, reason: null }
        : { ok: false, reason: s.reason ?? 'unavailable' }
    } catch (err) {
      value = { ok: false, reason: `status failed: ${(err as Error).message}` }
    }
    cached = { at: now, value }
    return value
  }

  return {
    provider: 'apple',
    availability,
    supportsJsonSchema: () => true,

    async generate(req: BackendRequest): Promise<BackendResult> {
      const helper = opts.helper
      if (!helper) throw new BackendError('unavailable', 'no helper')
      if (req.output.kind !== 'json' || !req.output.schema) {
        throw new BackendError('bad_request', 'on-device model needs a JSON schema')
      }
      const prompt = req.messages
        .map((m, i) =>
          req.messages.length === 1 ? m.content : `${m.role.toUpperCase()} ${i + 1}:\n${m.content}`,
        )
        .join('\n\n')
      const call = helper.call(
        'llm.onDevice.generate',
        {
          instructions: req.system,
          prompt,
          schema: req.output.schema,
          maxTokens: req.maxOutputTokens,
          temperature: req.temperature,
        },
        { timeoutMs: 60_000 },
      )
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(new BackendError('timeout', 'on-device call aborted'))
        if (req.signal.aborted) fail()
        else req.signal.addEventListener('abort', fail, { once: true })
      })
      try {
        const r = await Promise.race([call, aborted])
        return {
          text: typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? null),
          usage: { inputTokens: r.tokensIn, outputTokens: r.tokensOut },
          headers: {},
          toolCalls: [],
          finishReason: 'stop',
        }
      } catch (err) {
        if (err instanceof BackendError) throw err
        cached = null // re-check availability next time
        const message = (err as Error).message ?? String(err)
        throw new BackendError(
          /context|too long|exceed/i.test(message) ? 'bad_request' : 'server',
          message,
        )
      }
    },

    // biome-ignore lint/correctness/useYield: the on-device model is never used for streaming chat
    async *stream(): AsyncIterable<StreamPart> {
      throw new BackendError('unavailable', 'on-device model does not stream')
    },
  }
}
