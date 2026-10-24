/**
 * Ref-counted "Dumbledore is working" signal: the orb's thinking ring stays on while any flow is
 * waiting on the Brain, and turns off when the last one finishes.
 */
import type { EngineBus } from '@engine/events'

export class Thinking {
  private count = 0

  constructor(private readonly bus: EngineBus) {}

  get busy(): boolean {
    return this.count > 0
  }

  async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.begin(label)
    try {
      return await fn()
    } finally {
      this.end()
    }
  }

  begin(label: string): void {
    this.count++
    if (this.count === 1) this.bus.emit('thinking:changed', { busy: true, label })
  }

  end(): void {
    if (this.count === 0) return
    this.count--
    if (this.count === 0) this.bus.emit('thinking:changed', { busy: false, label: null })
  }
}
