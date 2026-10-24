/**
 * Push events (`ipcEvents`) to the windows that need them. The route table says which surfaces
 * get which event; `navigate` only goes to an explicit target. Payloads are validated against
 * the contract in development and tests.
 */
import type { Surface } from '@shared/constants'
import { type EventChannel, type EventPayload, IPC_EVENT_PREFIX, ipcEvents } from '@shared/ipc'

export const EVENT_ROUTES: Record<EventChannel, readonly Surface[]> = {
  'state.changed': ['overlay', 'panel', 'askbar', 'app'],
  'overlay.changed': ['overlay'],
  'memory.changed': ['panel', 'askbar', 'app'],
  'session.changed': ['overlay', 'panel', 'askbar', 'app'],
  'chat.delta': ['panel', 'askbar', 'app'],
  navigate: [],
  'key.gesture': ['app'],
}

/** Delivers a raw message to every live window of the given surfaces. */
export interface EventSink {
  send(surfaces: readonly Surface[], channel: string, payload: unknown): void
}

export class Broadcaster {
  constructor(
    private readonly sink: EventSink,
    private readonly validate = false,
  ) {}

  emit<E extends EventChannel>(event: E, payload: EventPayload<E>, to?: readonly Surface[]): void {
    if (this.validate) {
      const checked = ipcEvents[event].safeParse(payload)
      if (!checked.success) {
        console.error(`[ipc] invalid "${event}" payload`, checked.error.issues)
        return
      }
    }
    const surfaces = to ?? EVENT_ROUTES[event]
    if (surfaces.length > 0) this.sink.send(surfaces, `${IPC_EVENT_PREFIX}${event}`, payload)
  }
}
