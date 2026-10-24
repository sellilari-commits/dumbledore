/**
 * An in-page implementation of `DumbledoreApi` built from a table of channel handlers.
 *
 * The browser mock driver and the unit tests both use it, so the overlay and the Ask bar talk to
 * exactly the same typed surface they get from the preload in Electron.
 */
import type {
  DumbledoreApi,
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeReq,
  InvokeRes,
} from '@shared/ipc'

export type InvokeHandlers = {
  [C in InvokeChannel]?: (req: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>>
}

export interface LocalApi {
  api: DumbledoreApi
  /** Push an event to every listener, like main does over IPC. */
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void
  /** Every invoke, in order — handy for assertions and for the mock's action log. */
  calls: Array<{ channel: InvokeChannel; payload: unknown }>
}

export function createLocalApi(
  surface: DumbledoreApi['surface'],
  handlers: InvokeHandlers,
): LocalApi {
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>()
  const calls: LocalApi['calls'] = []

  const invoke = async (channel: InvokeChannel, payload?: unknown): Promise<unknown> => {
    calls.push({ channel, payload })
    const handler = handlers[channel] as ((req: unknown) => unknown) | undefined
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler(payload)
  }

  const on = (event: EventChannel, listener: (payload: unknown) => void): (() => void) => {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
    }
  }

  const api: DumbledoreApi = {
    surface,
    invoke: invoke as DumbledoreApi['invoke'],
    on: on as DumbledoreApi['on'],
  }

  return {
    api,
    calls,
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload)
    },
  }
}
