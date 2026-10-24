/** Shared types for the mock API's handler modules. */
import type { EventChannel, EventPayload, InvokeChannel, InvokeReq, InvokeRes } from '@shared/ipc'
import type { MemoryScope } from '@shared/state'
import type { MockDb } from './db'

export interface MockContext {
  db: MockDb
  surface: 'overlay' | 'panel' | 'askbar' | 'app'
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void
  /** Shorthand for a 'memory.changed' event. */
  changed(scope: MemoryScope, ids?: string[]): void
  later(ms: number, fn: () => void): void
  /** Shows an app route: navigates in the app window, opens the app from other surfaces. */
  openRoute(route: string): void
}

export type Handler<C extends InvokeChannel> = (
  ctx: MockContext,
  req: InvokeReq<C>,
) => InvokeRes<C> | Promise<InvokeRes<C>>

export type HandlerMap<C extends InvokeChannel> = { [K in C]: Handler<K> }
