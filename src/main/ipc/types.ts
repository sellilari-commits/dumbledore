/**
 * Types for main-side IPC handling: one handler per `ipcInvoke` channel, receiving the parsed
 * request and the calling window's context. `Handlers` is a mapped type, so the compiler
 * refuses a handler map that misses a channel.
 */
import type { Surface } from '@shared/constants'
import type { InvokeChannel, InvokeRes, ipcInvoke } from '@shared/ipc'
import type { z } from 'zod'

export interface InvokeContext {
  surface: Surface
  /** Overlay windows: the display they cover. */
  displayId: number | null
}

export type InvokeReqOut<C extends InvokeChannel> = z.output<(typeof ipcInvoke)[C]['req']>

export type Handler<C extends InvokeChannel> = (
  req: InvokeReqOut<C>,
  ctx: InvokeContext,
) => InvokeRes<C> | Promise<InvokeRes<C>>

export type Handlers = { [C in InvokeChannel]: Handler<C> }
