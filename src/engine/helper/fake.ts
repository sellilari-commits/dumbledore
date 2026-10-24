/**
 * FakeHelper — a scriptable HelperClient for tests, demos and E2E-sim runs.
 *
 *   const helper = new FakeHelper()
 *   await helper.start()
 *   helper.respond('frontmost', myFrontmost)                 // every call
 *   helper.respondOnce('perceive', (p) => ({ windows: [] }))  // next call only
 *   helper.fail('input.write', HelperErrorCode.secureInput, 'password field')
 *   helper.emit('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: false })
 *   helper.loadFixture(loadFixture('tests/fixtures/helper/session.json')); helper.replay(clock)
 *
 * Resolution order per call: one-shot responders → error → persistent responder → fixture
 * sequence → defaultResult(). Params are parsed (defaults applied) and results validated against
 * the protocol, so tests fail early on contract mistakes. Calls are recorded in `calls`.
 */
import {
  type HelperEvent,
  type HelperEventPayload,
  type HelperMethod,
  type HelperParams,
  type HelperResult,
  helperMethods,
} from '@shared/helper-protocol'
import type { z } from 'zod'
import { type Cancel, type Clock, systemClock } from '../clock'
import type { HelperClient, HelperStatus } from '../contracts'
import { HelperClientErrorCode, HelperRpcError } from './errors'
import { HelperEventHub } from './events'
import { defaultResult, type HelperFixture, parseFixture } from './fixtures'

/** Params after protocol parsing (defaults applied). */
export type ParsedParams<M extends HelperMethod> = z.output<(typeof helperMethods)[M]['params']>

export type Responder<M extends HelperMethod> =
  | HelperResult<M>
  | ((params: ParsedParams<M>, callIndex: number) => HelperResult<M> | Promise<HelperResult<M>>)

export interface FakeCall {
  method: HelperMethod
  params: unknown
  at: number
}

type Spec = { params: z.ZodType; result: z.ZodType }
type AnyResponder = Responder<HelperMethod>
type ScriptedError = { code: number; message: string; data?: unknown; once: boolean }

export class FakeHelper implements HelperClient {
  readonly calls: FakeCall[] = []
  private readonly hub = new HelperEventHub()
  private readonly once = new Map<HelperMethod, AnyResponder[]>()
  private readonly persistent = new Map<HelperMethod, AnyResponder>()
  private readonly errors = new Map<HelperMethod, ScriptedError[]>()
  private sequences = new Map<HelperMethod, unknown[]>()
  private fixture: HelperFixture | null = null
  private readonly clock: Clock
  private readonly latencyMs: number

  constructor(
    opts: { clock?: Clock; latencyMs?: number; fixture?: HelperFixture; connected?: boolean } = {},
  ) {
    this.clock = opts.clock ?? systemClock
    this.latencyMs = opts.latencyMs ?? 0
    if (opts.fixture) this.loadFixture(opts.fixture)
    if (opts.connected) this.hub.setStatus('connected')
  }

  get status(): HelperStatus {
    return this.hub.status
  }

  async start(): Promise<void> {
    this.hub.setStatus('connected')
  }

  async stop(): Promise<void> {
    this.hub.setStatus('down')
  }

  /** Simulates crashes and restarts ('down' → 'starting' → 'connected'). */
  setStatus(status: HelperStatus): void {
    this.hub.setStatus(status)
  }

  async call<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    _opts?: { timeoutMs?: number },
  ): Promise<HelperResult<M>> {
    const spec = helperMethods[method] as unknown as Spec
    const parsed = spec.params.safeParse(params ?? {})
    if (!parsed.success)
      throw new HelperRpcError(-32602, `invalid ${method} params`, parsed.error.issues)
    const index = this.calls.filter((c) => c.method === method).length
    this.calls.push({ method, params: parsed.data, at: this.clock.now() })
    if (this.status !== 'connected') {
      throw new HelperRpcError(HelperClientErrorCode.notConnected, `helper is ${this.status}`)
    }
    if (this.latencyMs > 0)
      await new Promise<void>((resolve) => this.clock.setTimeout(resolve, this.latencyMs))
    const raw = await this.resolve(method, parsed.data, index)
    const checked = spec.result.safeParse(raw)
    if (!checked.success)
      throw new Error(`FakeHelper: scripted ${method} result is invalid: ${checked.error.message}`)
    return checked.data as HelperResult<M>
  }

  private async resolve(method: HelperMethod, params: unknown, index: number): Promise<unknown> {
    const queued = this.once.get(method)
    const next = queued?.shift()
    if (next !== undefined) return run(next, params, index)
    const errs = this.errors.get(method)
    const err = errs?.[0]
    if (err) {
      if (err.once) errs.shift()
      throw new HelperRpcError(err.code, err.message, err.data)
    }
    const responder = this.persistent.get(method)
    if (responder !== undefined) return run(responder, params, index)
    const seq = this.sequences.get(method)
    if (seq && seq.length > 0) return structuredClone(seq.length > 1 ? seq.shift() : seq[0])
    return defaultResult(method)
  }

  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    return this.hub.on(event, listener)
  }

  onStatus(listener: (status: HelperStatus) => void): () => void {
    return this.hub.onStatus(listener)
  }

  // ─── scripting ──────────────────────────────────────────────────────────────────────────────

  respond<M extends HelperMethod>(method: M, responder: Responder<M>): this {
    this.persistent.set(method, responder as AnyResponder)
    return this
  }

  respondOnce<M extends HelperMethod>(method: M, responder: Responder<M>): this {
    const list = this.once.get(method) ?? []
    list.push(responder as AnyResponder)
    this.once.set(method, list)
    return this
  }

  fail(
    method: HelperMethod,
    code: number,
    message: string,
    opts: { once?: boolean; data?: unknown } = {},
  ): this {
    const list = this.errors.get(method) ?? []
    list.push({ code, message, data: opts.data, once: opts.once ?? false })
    this.errors.set(method, list)
    return this
  }

  /** Emits a helper event (validated against the protocol). Throws on an invalid payload. */
  emit<E extends HelperEvent>(event: E, payload: HelperEventPayload<E>): void {
    if (!this.hub.dispatch(event, payload)) throw new Error(`FakeHelper: invalid ${event} payload`)
  }

  loadFixture(fixture: HelperFixture): this {
    this.fixture = parseFixture(fixture)
    this.sequences = new Map(
      Object.entries(this.fixture.responses ?? {}).map(([m, list]) => [
        m as HelperMethod,
        [...(list as unknown[])],
      ]),
    )
    for (const [m, e] of Object.entries(this.fixture.errors ?? {})) {
      if (e) this.fail(m as HelperMethod, e.code, e.message, { data: e.data })
    }
    return this
  }

  /** Schedules the fixture's events on `clock` (relative to now). Returns a cancel function. */
  replay(clock: Clock = this.clock): Cancel {
    const cancels = (this.fixture?.events ?? []).map((e) =>
      clock.setTimeout(() => this.hub.dispatch(e.event, e.payload), e.atMs),
    )
    return () => {
      for (const cancel of cancels) cancel()
    }
  }

  callsOf<M extends HelperMethod>(method: M): ParsedParams<M>[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params as ParsedParams<M>)
  }

  /** Texts passed to input.write, in order. */
  writes(): string[] {
    return this.callsOf('input.write').map((p) => p.text)
  }

  listenerCount(event: HelperEvent): number {
    return this.hub.listenerCount(event)
  }

  reset(): void {
    this.calls.length = 0
    this.once.clear()
    this.persistent.clear()
    this.errors.clear()
    this.sequences.clear()
    this.fixture = null
  }
}

function run(responder: AnyResponder, params: unknown, index: number): unknown {
  return typeof responder === 'function'
    ? (responder as (p: unknown, i: number) => unknown)(params, index)
    : structuredClone(responder)
}
