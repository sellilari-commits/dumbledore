/**
 * Registers every `ipcInvoke` channel with ipcMain. Each call is checked twice: the sender must
 * be one of our windows (allow-list), and the payload must match the channel's zod schema.
 * Responses are validated too in development and tests, so contract drift fails loudly.
 */
import { type InvokeChannel, type InvokeRes, IPC_INVOKE_PREFIX, ipcInvoke } from '@shared/ipc'
import { z } from 'zod'
import type { Handler, Handlers, InvokeContext, InvokeReqOut } from './types'

export interface InvokeEventLike {
  sender: unknown
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: InvokeEventLike, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
}

export interface RegisterOptions {
  /** Context of the calling window; null for anything that is not one of our windows. */
  identify: (event: InvokeEventLike) => InvokeContext | null
  validateResponses?: boolean
  onError?: (channel: InvokeChannel, error: unknown) => void
}

export class IpcValidationError extends Error {
  constructor(channel: string, detail: string) {
    super(`Invalid payload for "${channel}": ${detail}`)
    this.name = 'IpcValidationError'
  }
}

export const INVOKE_CHANNELS = Object.keys(ipcInvoke) as InvokeChannel[]

/** Validates, dispatches and (optionally) checks the response of one call. */
export async function runHandler<C extends InvokeChannel>(
  channel: C,
  handlers: Handlers,
  payload: unknown,
  ctx: InvokeContext,
  validateResponses = false,
): Promise<InvokeRes<C>> {
  const spec = ipcInvoke[channel]
  if (!spec) throw new IpcValidationError(String(channel), 'unknown channel')
  const parsed = spec.req.safeParse(payload)
  if (!parsed.success) throw new IpcValidationError(channel, z.prettifyError(parsed.error))
  const handler = handlers[channel] as Handler<C>
  const result = await handler(parsed.data as InvokeReqOut<C>, ctx)
  if (validateResponses) {
    const checked = spec.res.safeParse(result)
    if (!checked.success) {
      throw new Error(
        `Handler for "${channel}" returned an invalid response: ${z.prettifyError(checked.error)}`,
      )
    }
  }
  return result
}

export function registerIpc(
  ipc: IpcMainLike,
  handlers: Handlers,
  opts: RegisterOptions,
): () => void {
  for (const channel of INVOKE_CHANNELS) {
    ipc.handle(`${IPC_INVOKE_PREFIX}${channel}`, async (event, payload) => {
      const ctx = opts.identify(event)
      if (!ctx) throw new Error(`Refused "${channel}": unknown sender`)
      try {
        return await runHandler(channel, handlers, payload, ctx, opts.validateResponses)
      } catch (error) {
        opts.onError?.(channel, error)
        throw error
      }
    })
  }
  return () => {
    for (const channel of INVOKE_CHANNELS) ipc.removeHandler(`${IPC_INVOKE_PREFIX}${channel}`)
  }
}
