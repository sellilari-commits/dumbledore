/**
 * Start/stop bookkeeping for the real composition: named steps that start in order and stop in
 * reverse order. start() and stop() are idempotent and serialized (a stop during a start waits
 * for it); a failing step is logged and does not keep the others from stopping.
 */

export interface LifecycleStep {
  name: string
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

export type LifecycleLog = (message: string, error?: unknown) => void

export class Lifecycle {
  private running = false
  private current: Promise<void> = Promise.resolve()

  constructor(
    private readonly steps: readonly LifecycleStep[],
    private readonly log: LifecycleLog,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  start(): Promise<void> {
    if (this.running) return this.current
    this.running = true
    this.current = this.after(this.current).then(() => this.run('start'))
    return this.current
  }

  stop(): Promise<void> {
    if (!this.running) return this.after(this.current)
    this.running = false
    this.current = this.after(this.current).then(() => this.run('stop'))
    return this.current
  }

  private after(p: Promise<void>): Promise<void> {
    return p.catch(() => undefined)
  }

  private async run(phase: 'start' | 'stop'): Promise<void> {
    const steps = phase === 'start' ? this.steps : [...this.steps].reverse()
    for (const step of steps) {
      try {
        await step[phase]()
      } catch (error) {
        this.log(`[engine] ${phase} of ${step.name} failed`, error)
        if (phase === 'start') throw error
      }
    }
  }
}
