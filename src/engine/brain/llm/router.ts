/**
 * The LLM router (docs/PLAN.md §6.5): ordered (provider, model) candidates per tier; skips
 * providers that are unavailable, out of budget, too small for the request or wrong for the
 * language; waits on per-model token buckets when the wait is short, otherwise falls through;
 * retries 429/5xx/timeouts with backoff; enforces the task deadline; redacts every cloud request;
 * logs every call to the usage repo; skips paid routes ('over-budget') once the spend cap
 * (spend.ts) would be passed.
 */
import { BrainTimeoutError, BrainUnavailableError } from '@engine/brain-contract'
import {
  DEFAULT_ROUTES,
  type LlmTier,
  type ModelRoute,
  PROVIDER_LIMITS,
  type ProviderId,
  type ProviderLimits,
} from '@shared/llm'
import type { Clock } from '../../clock'
import type { UsageRepo } from '../../contracts'
import { DailyBudget } from './budget'
import { TimeoutReason, toBackendError } from './cloud-backend'
import { RateLimiter } from './limits'
import { priceOf } from './prices'
import { capFromEnv, SpendTracker } from './spend'
import { estimateMessagesTokens } from './text'
import {
  type Backend,
  BackendError,
  type BackendRequest,
  type BackendResult,
  type StreamPart,
} from './types'

export interface RouterDeps {
  backends: Partial<Record<ProviderId, Backend>>
  clock: Clock
  usage?: UsageRepo | null
  /** Applied to every string sent to a cloud provider (default: identity). */
  redact?: (text: string) => string
  /** Candidate list per tier (default DEFAULT_ROUTES); read on every call so Settings apply live. */
  routes?: (tier: LlmTier) => ModelRoute[]
  limits?: Partial<Record<ProviderId, Partial<ProviderLimits>>>
  tierTokensPerDay?: Partial<Record<LlmTier, number>>
  /** Hard cap on paid-provider spend, EUR (default: DUMBLEDORE_BUDGET_EUR or 10). */
  spendCapEur?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export interface CallPlan {
  task: string
  tier: LlmTier
  /** Epoch ms; the whole task (fall-throughs and repairs included) must finish by then. */
  deadline: number
  signal?: AbortSignal
  /** Input + max output tokens of one call, for buckets and size checks. */
  estimatedTokens: number
  /** The max output part of estimatedTokens (spend estimate; default: all of it, the safe side). */
  outputTokens?: number
  /** Content language ("en", "fi", …); Finnish never goes to the on-device model. */
  language: string
  /** False when the task must not use the on-device model (no schema, too weak, …). */
  onDeviceOk: boolean
  /** Size of the (compact) on-device variant of the request, when it differs. */
  onDeviceTokens?: number
}

/** One candidate the router is trying; `call` performs a single logged backend request. */
export interface Attempt {
  route: ModelRoute
  backend: Backend
  deadline: number
  call(req: Omit<BackendRequest, 'model' | 'signal'>): Promise<BackendResult>
}

/** Thrown by an attempt callback when the model answered but the answer is unusable. */
export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOutputError'
  }
}

/** Longest bucket wait we accept before preferring the next candidate, per tier. */
const SHORT_WAIT_MS: Record<LlmTier, number> = {
  triage: 1500,
  extract: 3000,
  reason: 2500,
  write: 250,
  chat: 600,
}
/** Minimum time a call needs to be worth starting. */
const MIN_ATTEMPT_MS: Record<LlmTier, number> = {
  triage: 800,
  extract: 1500,
  reason: 2000,
  write: 400,
  chat: 1000,
}
const MAX_TRIES_PER_ROUTE = 2

const defaultSleep = (clock: Clock) => (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const cancel = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      cancel()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

export function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

export class Router {
  readonly limiter: RateLimiter
  readonly budget: DailyBudget
  readonly spend: SpendTracker
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>

  constructor(private readonly deps: RouterDeps) {
    this.limiter = new RateLimiter(deps.clock, (p, m) => this.limitsFor(p, m))
    this.budget = new DailyBudget({
      usage: deps.usage ?? null,
      clock: deps.clock,
      limitsFor: (p, m) => this.limitsFor(p, m),
      tierTokensPerDay: deps.tierTokensPerDay,
    })
    this.spend = new SpendTracker(deps.usage ?? null, deps.spendCapEur ?? capFromEnv())
    this.sleep = deps.sleep ?? defaultSleep(deps.clock)
  }

  limitsFor(provider: ProviderId, _model: string): ProviderLimits {
    return { ...PROVIDER_LIMITS[provider], ...this.deps.limits?.[provider] }
  }

  /** 'over-budget' when this call's worst-case cost would pass the spend cap. */
  private overSpend(
    plan: CallPlan,
    route: ModelRoute,
    backend: Backend,
    totalTokens: number,
    outputTokens: number | undefined,
  ): string | null {
    const out = Math.min(totalTokens, outputTokens ?? totalTokens)
    const billed = backend.billableOutputTokens?.(route.model, plan.tier, out) ?? out
    return this.spend.check(route.provider, route.model, totalTokens - out, billed)
  }

  routesFor(tier: LlmTier): ModelRoute[] {
    return this.deps.routes?.(tier) ?? DEFAULT_ROUTES[tier]
  }

  /** Candidates that may serve this plan, in preference order, plus why the others were skipped. */
  async candidates(plan: CallPlan): Promise<{ usable: ModelRoute[]; skipped: string[] }> {
    const usable: ModelRoute[] = []
    const skipped: string[] = []
    const seen = new Set<string>()
    for (const route of this.routesFor(plan.tier)) {
      const key = `${route.provider}:${route.model}`
      if (seen.has(key)) continue
      seen.add(key)
      const backend = this.deps.backends[route.provider]
      if (!backend) {
        skipped.push(`${key}: no backend`)
        continue
      }
      const limits = this.limitsFor(route.provider, route.model)
      if (route.provider === 'apple') {
        if (!plan.onDeviceOk) {
          skipped.push(`${key}: task not suited to on-device`)
          continue
        }
        if (plan.language === 'fi') {
          skipped.push(`${key}: Finnish content`)
          continue
        }
      }
      const size =
        route.provider === 'apple'
          ? (plan.onDeviceTokens ?? plan.estimatedTokens)
          : plan.estimatedTokens
      if (limits.contextTokens != null && size > limits.contextTokens) {
        skipped.push(`${key}: request larger than context`)
        continue
      }
      if (!this.limiter.fits(route.provider, route.model, plan.estimatedTokens)) {
        skipped.push(`${key}: request larger than tokens/minute limit`)
        continue
      }
      const over =
        this.budget.check(route.provider, route.model, plan.tier, plan.estimatedTokens) ??
        this.overSpend(plan, route, backend, plan.estimatedTokens, plan.outputTokens)
      if (over) {
        skipped.push(`${key}: ${over}`)
        continue
      }
      const avail = await backend.availability()
      if (!avail.ok) {
        skipped.push(`${key}: ${avail.reason ?? 'unavailable'}`)
        continue
      }
      usable.push(route)
    }
    return { usable, skipped }
  }

  /** Runs `attempt` against candidates until one succeeds, the deadline passes or all fail. */
  async run<T>(plan: CallPlan, attempt: (a: Attempt) => Promise<T>): Promise<T> {
    const { usable, skipped } = await this.candidates(plan)
    const errors = [...skipped]
    const tries = new Map<ModelRoute, number>()
    const clock = this.deps.clock
    const control = new AbortController()
    const onCallerAbort = () => control.abort(plan.signal?.reason)
    plan.signal?.addEventListener('abort', onCallerAbort, { once: true })
    try {
      for (;;) {
        if (plan.signal?.aborted) throw abortError()
        const remaining = plan.deadline - clock.now()
        if (remaining <= 0) throw new BrainTimeoutError(plan.task)
        const pick = this.pick(plan, usable, tries, remaining)
        if (!pick) {
          for (const r of usable) {
            if ((tries.get(r) ?? 0) >= MAX_TRIES_PER_ROUTE) continue
            const wait = this.limiter.waitMs(r.provider, r.model, plan.estimatedTokens)
            errors.push(
              `${r.provider}:${r.model}: rate limited (next slot in ${Math.ceil(wait / 1000)} s)`,
            )
          }
          break
        }
        if (pick.wait > 0) {
          await this.sleep(pick.wait, control.signal).catch(() => {
            throw plan.signal?.aborted ? abortError() : new BrainTimeoutError(plan.task)
          })
          continue // re-evaluate after waiting: buckets may have changed
        }
        const route = pick.route
        tries.set(route, (tries.get(route) ?? 0) + 1)
        const backend = this.deps.backends[route.provider] as Backend
        try {
          return await attempt({
            route,
            backend,
            deadline: plan.deadline,
            call: (req) => this.callOnce(plan, route, backend, req),
          })
        } catch (err) {
          if (err instanceof BrainTimeoutError) throw err
          if (plan.signal?.aborted) throw abortError()
          const key = `${route.provider}:${route.model}`
          if (err instanceof InvalidOutputError) {
            errors.push(`${key}: ${err.message}`)
            tries.set(route, MAX_TRIES_PER_ROUTE)
            continue
          }
          if (!(err instanceof BackendError)) throw err // a bug in the attempt callback, not the model
          const be = err
          if (be.kind === 'aborted') throw abortError()
          errors.push(`${key}: ${be.kind} ${be.message}`.slice(0, 200))
          if (be.kind === 'timeout' && clock.now() >= plan.deadline)
            throw new BrainTimeoutError(plan.task)
          if (be.kind === 'rate_limit') {
            this.limiter.cooldown(route.provider, route.model, be.retryAfterMs ?? 20_000)
          } else if (be.kind === 'server' || be.kind === 'network' || be.kind === 'timeout') {
            const backoff = 400 * 2 ** ((tries.get(route) ?? 1) - 1)
            this.limiter.cooldown(route.provider, route.model, backoff)
          } else {
            tries.set(route, MAX_TRIES_PER_ROUTE) // auth / bad request / unavailable: don't retry this route
          }
        }
      }
    } finally {
      plan.signal?.removeEventListener('abort', onCallerAbort)
    }
    if (clock.now() >= plan.deadline) throw new BrainTimeoutError(plan.task)
    throw new BrainUnavailableError(plan.task, errors.join('; ') || 'no model configured')
  }

  /** Next route to try (wait = 0) or how long to wait for the best one; null = none left. */
  private pick(
    plan: CallPlan,
    usable: ModelRoute[],
    tries: Map<ModelRoute, number>,
    remaining: number,
  ): { route: ModelRoute; wait: number } | null {
    const open = usable.filter((r) => (tries.get(r) ?? 0) < MAX_TRIES_PER_ROUTE)
    if (open.length === 0) return null
    const budget = remaining - MIN_ATTEMPT_MS[plan.tier]
    const waits = open.map((route) => ({
      route,
      wait: this.limiter.waitMs(route.provider, route.model, plan.estimatedTokens),
    }))
    const soon = waits.find(
      (w) => w.wait === 0 || w.wait <= Math.min(SHORT_WAIT_MS[plan.tier], budget),
    )
    if (soon) return soon
    const best = waits.reduce((a, b) => (b.wait < a.wait ? b : a))
    if (best.wait <= budget) return best
    return null
  }

  private redactRequest(
    provider: ProviderId,
    req: Omit<BackendRequest, 'model' | 'signal'>,
  ): Omit<BackendRequest, 'model' | 'signal'> {
    const redact = this.deps.redact
    if (!redact || provider === 'apple') return req
    return {
      ...req,
      system: redact(req.system),
      messages: req.messages.map((m) => ({ ...m, content: redact(m.content) })),
    }
  }

  private async callOnce(
    plan: CallPlan,
    route: ModelRoute,
    backend: Backend,
    raw: Omit<BackendRequest, 'model' | 'signal'>,
  ): Promise<BackendResult> {
    const clock = this.deps.clock
    const req = this.redactRequest(route.provider, raw)
    const inputEst = estimateMessagesTokens(req.system, req.messages)
    const est = inputEst + req.maxOutputTokens
    // Every call (repairs too) must fit under the spend cap.
    if (this.overSpend(plan, route, backend, est, req.maxOutputTokens)) {
      throw new BackendError('unavailable', 'over-budget')
    }
    // Follow-up calls (repairs) also respect the buckets: wait if it fits the deadline.
    const wait = this.limiter.waitMs(route.provider, route.model, est)
    if (wait > 0) {
      if (wait >= plan.deadline - clock.now() - MIN_ATTEMPT_MS[plan.tier]) {
        throw new BackendError(
          'rate_limit',
          `no ${route.provider}:${route.model} slot before the deadline`,
        )
      }
      const control = new AbortController()
      const onAbort = () => control.abort(plan.signal?.reason)
      plan.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        await this.sleep(wait, control.signal)
      } catch {
        throw abortError()
      } finally {
        plan.signal?.removeEventListener('abort', onAbort)
      }
    }
    const remaining = plan.deadline - clock.now()
    if (remaining <= 0) throw new BrainTimeoutError(plan.task)
    const control = new AbortController()
    const cancelTimer = clock.setTimeout(() => control.abort(new TimeoutReason()), remaining)
    const onCallerAbort = () => control.abort(plan.signal?.reason)
    plan.signal?.addEventListener('abort', onCallerAbort, { once: true })
    this.limiter.take(route.provider, route.model, est)
    const started = clock.now()
    try {
      const res = await backend.generate({
        ...req,
        model: route.model,
        tier: plan.tier,
        signal: control.signal,
      })
      const tokensIn = res.usage.inputTokens ?? estimateMessagesTokens(req.system, req.messages)
      const tokensOut = res.usage.outputTokens ?? 0
      this.limiter.observe(route.provider, route.model, res.headers)
      this.limiter.settle(route.provider, route.model, est, tokensIn + tokensOut)
      this.budget.charge(plan.tier, tokensIn + tokensOut)
      this.record(plan, route, tokensIn, tokensOut, clock.now() - started, null)
      return res
    } catch (err) {
      const be = toBackendError(err, control.signal)
      this.limiter.observe(route.provider, route.model, be.headers)
      this.limiter.settle(route.provider, route.model, est, null)
      const [tin, tout] = this.unknownUsage(plan, route, backend, be, inputEst, req.maxOutputTokens)
      this.record(plan, route, tin, tout, clock.now() - started, `${be.kind}: ${be.message}`)
      throw be
    } finally {
      cancelTimer()
      plan.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  /** Streams one request (coach chat). Falls through only until the first part arrives. */
  async *stream(
    plan: CallPlan,
    raw: Omit<BackendRequest, 'model' | 'signal'>,
  ): AsyncIterable<StreamPart> {
    const { usable, skipped } = await this.candidates(plan)
    const errors = [...skipped]
    const clock = this.deps.clock
    for (const route of usable) {
      if (plan.signal?.aborted) throw abortError()
      if (clock.now() >= plan.deadline) throw new BrainTimeoutError(plan.task)
      const wait = this.limiter.waitMs(route.provider, route.model, plan.estimatedTokens)
      if (wait > SHORT_WAIT_MS[plan.tier]) {
        errors.push(`${route.provider}:${route.model}: rate limited`)
        continue
      }
      const backend = this.deps.backends[route.provider] as Backend
      const req = this.redactRequest(route.provider, raw)
      const est = estimateMessagesTokens(req.system, req.messages) + req.maxOutputTokens
      const control = new AbortController()
      const cancelTimer = clock.setTimeout(
        () => control.abort(new TimeoutReason()),
        Math.max(1, plan.deadline - clock.now()),
      )
      const onCallerAbort = () => control.abort(plan.signal?.reason)
      plan.signal?.addEventListener('abort', onCallerAbort, { once: true })
      this.limiter.take(route.provider, route.model, est)
      const started = clock.now()
      let emitted = false
      let usage = { inputTokens: 0, outputTokens: 0 }
      try {
        for await (const part of backend.stream({
          ...req,
          model: route.model,
          tier: plan.tier,
          signal: control.signal,
        })) {
          if (part.type === 'finish') {
            usage = {
              inputTokens: part.usage.inputTokens ?? 0,
              outputTokens: part.usage.outputTokens ?? 0,
            }
            this.limiter.observe(route.provider, route.model, part.headers)
          }
          emitted = true
          yield part
        }
        this.limiter.settle(
          route.provider,
          route.model,
          est,
          usage.inputTokens + usage.outputTokens,
        )
        this.budget.charge(plan.tier, usage.inputTokens + usage.outputTokens)
        this.record(plan, route, usage.inputTokens, usage.outputTokens, clock.now() - started, null)
        return
      } catch (err) {
        const be = toBackendError(err, control.signal)
        this.limiter.observe(route.provider, route.model, be.headers)
        this.limiter.settle(route.provider, route.model, est, null)
        const inputEst = est - req.maxOutputTokens
        const [tin, tout] = this.unknownUsage(
          plan,
          route,
          backend,
          be,
          inputEst,
          req.maxOutputTokens,
        )
        this.record(plan, route, tin, tout, clock.now() - started, `${be.kind}: ${be.message}`)
        if (be.kind === 'aborted' || plan.signal?.aborted) throw abortError()
        if (be.kind === 'rate_limit')
          this.limiter.cooldown(route.provider, route.model, be.retryAfterMs ?? 20_000)
        if (emitted) throw be.kind === 'timeout' ? new BrainTimeoutError(plan.task) : be
        errors.push(`${route.provider}:${route.model}: ${be.kind} ${be.message}`.slice(0, 200))
      } finally {
        cancelTimer()
        plan.signal?.removeEventListener('abort', onCallerAbort)
      }
    }
    if (clock.now() >= plan.deadline) throw new BrainTimeoutError(plan.task)
    throw new BrainUnavailableError(plan.task, errors.join('; ') || 'no model configured')
  }

  /**
   * Tokens to log for a failed call. A paid request cut off by a timeout or cancel may still be
   * billed, so it is logged at its worst case (input + max billable output); others as 0.
   */
  private unknownUsage(
    plan: CallPlan,
    route: ModelRoute,
    backend: Backend,
    err: BackendError,
    inputTokens: number,
    maxOutputTokens: number,
  ): [number, number] {
    if (err.kind !== 'timeout' && err.kind !== 'aborted') return [0, 0]
    if (!priceOf(route.provider, route.model)) return [0, 0]
    const out = backend.billableOutputTokens?.(route.model, plan.tier, maxOutputTokens)
    return [inputTokens, out ?? maxOutputTokens]
  }

  private record(
    plan: CallPlan,
    route: ModelRoute,
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
    error: string | null,
  ): void {
    let logged = false
    try {
      this.deps.usage?.record({
        at: this.deps.clock.nowIso(),
        provider: route.provider,
        model: route.model,
        tier: plan.tier,
        task: plan.task,
        tokensIn,
        tokensOut,
        latencyMs,
        ok: error === null,
        error: error ? error.slice(0, 300) : null,
      })
      logged = !!this.deps.usage
    } catch {
      // usage logging must never break a call
    }
    if (!logged) this.spend.addUnlogged(route.provider, route.model, tokensIn, tokensOut)
  }
}
