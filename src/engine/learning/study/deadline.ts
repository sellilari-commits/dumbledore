/**
 * Runs a brain call under a hard deadline measured on the injected Clock (FakeClock in tests).
 *
 * The brain also receives `timeoutMs` and an AbortSignal, so a real router can stop early; this
 * wrapper guarantees the caller gets control back on time even if it doesn't.
 */
import { BrainTimeoutError, type CallOptions } from '../../brain-contract'
import type { Cancel, Clock } from '../../clock'

export async function withDeadline<T>(
  clock: Clock,
  ms: number,
  task: string,
  run: (opts: CallOptions) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let cancel: Cancel = () => {}
  const timeout = new Promise<never>((_, reject) => {
    cancel = clock.setTimeout(() => {
      controller.abort()
      reject(new BrainTimeoutError(task))
    }, ms)
  })
  try {
    return await Promise.race([run({ timeoutMs: ms, signal: controller.signal }), timeout])
  } finally {
    cancel()
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
