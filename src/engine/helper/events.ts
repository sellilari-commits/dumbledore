/**
 * Listener bookkeeping shared by the real client and the fake: typed helper events (validated
 * against the protocol before delivery) and status changes. A failing listener never affects
 * the others.
 */
import { type HelperEvent, type HelperEventPayload, helperEvents } from '@shared/helper-protocol'
import type { z } from 'zod'
import type { HelperStatus } from '../contracts'
import type { LogFn } from './launcher'

export class HelperEventHub {
  private readonly listeners = new Map<HelperEvent, Set<(payload: unknown) => void>>()
  private readonly statusListeners = new Set<(status: HelperStatus) => void>()
  private current: HelperStatus = 'down'

  constructor(private readonly log: LogFn = () => {}) {}

  get status(): HelperStatus {
    return this.current
  }

  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    const fn = listener as (payload: unknown) => void
    set.add(fn)
    return () => {
      set?.delete(fn)
    }
  }

  onStatus(listener: (status: HelperStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  listenerCount(event: HelperEvent): number {
    return this.listeners.get(event)?.size ?? 0
  }

  /** Validates `params` as event `method` and delivers it. Returns false when rejected. */
  dispatch(method: string, params: unknown): boolean {
    if (!Object.hasOwn(helperEvents, method)) {
      this.log('debug', `unknown helper event ${method}`)
      return false
    }
    const event = method as HelperEvent
    const parsed = (helperEvents[event] as z.ZodType).safeParse(params)
    if (!parsed.success) {
      this.log('warn', `invalid ${event} event from helper`)
      return false
    }
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(parsed.data)
      } catch (error) {
        this.log('error', `listener for ${event} failed: ${String(error)}`)
      }
    }
    return true
  }

  setStatus(status: HelperStatus): void {
    if (status === this.current) return
    this.current = status
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status)
      } catch (error) {
        this.log('error', `status listener failed: ${String(error)}`)
      }
    }
  }
}
