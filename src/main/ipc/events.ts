/**
 * Engine bus → window events: session and memory changes go out as they happen; AppState is
 * rebuilt and sent once per tick however many things changed in it.
 */
import type { EngineBus } from '@engine/events'
import type { AppState } from '@shared/state'
import type { Broadcaster } from './broadcast'

export function wireBroadcasts(bus: EngineBus, out: Broadcaster): () => void {
  const offs = [
    bus.on('session:changed', ({ session }) => out.emit('session.changed', session)),
    bus.on('memory:changed', (change) => out.emit('memory.changed', change)),
  ]
  return () => {
    for (const off of offs) off()
  }
}

/** Coalesces AppState broadcasts: many changes in one tick → one 'state.changed'. */
export class StateBroadcast {
  private pending = false

  constructor(
    private readonly build: () => AppState,
    private readonly send: (state: AppState) => void,
  ) {}

  schedule(): void {
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      try {
        this.send(this.build())
      } catch (error) {
        console.error('[ipc] building AppState failed', error)
      }
    })
  }
}
