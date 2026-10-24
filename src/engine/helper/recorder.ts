/**
 * HelperRecorder — wraps a live HelperClient and records results and events into a fixture that
 * FakeHelper can replay later (e.g. capture a real study session once, test the pipeline forever).
 * Errors are not recorded; recorded text may contain screen content, so review fixtures before
 * committing them.
 */
import type {
  HelperEvent,
  HelperEventPayload,
  HelperMethod,
  HelperParams,
  HelperResult,
} from '@shared/helper-protocol'
import { type Clock, systemClock } from '../clock'
import type { HelperClient, HelperStatus } from '../contracts'
import type { HelperFixture } from './fixtures'

export class HelperRecorder implements HelperClient {
  private readonly responses = new Map<HelperMethod, unknown[]>()
  private readonly events: NonNullable<HelperFixture['events']> = []
  private readonly startedAt: number
  private readonly unsubscribers: (() => void)[] = []

  constructor(
    private readonly inner: HelperClient,
    clock: Clock = systemClock,
    record: readonly HelperEvent[] = [
      'focus.changed',
      'app.activated',
      'key.trigger',
      'screen.locked',
      'screen.unlocked',
    ],
  ) {
    this.startedAt = clock.now()
    for (const event of record) {
      this.unsubscribers.push(
        inner.on(event, (payload) =>
          this.events.push({ atMs: clock.now() - this.startedAt, event, payload }),
        ),
      )
    }
  }

  get status(): HelperStatus {
    return this.inner.status
  }

  start(): Promise<void> {
    return this.inner.start()
  }

  stop(): Promise<void> {
    for (const off of this.unsubscribers.splice(0)) off()
    return this.inner.stop()
  }

  async call<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    opts?: { timeoutMs?: number },
  ): Promise<HelperResult<M>> {
    const result = await this.inner.call(method, params, opts)
    const list = this.responses.get(method) ?? []
    list.push(structuredClone(result))
    this.responses.set(method, list)
    return result
  }

  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    return this.inner.on(event, listener)
  }

  onStatus(listener: (status: HelperStatus) => void): () => void {
    return this.inner.onStatus(listener)
  }

  toFixture(description?: string): HelperFixture {
    return {
      version: 1,
      ...(description ? { description } : {}),
      responses: Object.fromEntries(this.responses),
      events: [...this.events],
    }
  }
}
