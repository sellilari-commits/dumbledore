/**
 * One socket connection to the helper: request/response matching, per-call timeouts and
 * notification delivery. No validation and no lifecycle — SocketHelperClient owns those.
 */
import { createConnection, type Socket } from 'node:net'
import { HelperErrorCode } from '@shared/helper-protocol'
import { HelperClientErrorCode, HelperRpcError } from './errors'
import { classify, encodeRequest, LineBuffer } from './framing'

export interface ConnectionHandlers {
  onNotification(method: string, params: unknown): void
  onClose(): void
  onInvalid?(reason: string): void
}

interface Pending {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Connects to a Unix socket; rejects on error or after `timeoutMs`. */
export function connectSocket(path: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`connect to ${path} timed out`))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    })
  })
}

export class HelperConnection {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly lines = new LineBuffer()
  private closed = false

  constructor(
    private readonly socket: Socket,
    private readonly handlers: ConnectionHandlers,
  ) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('error', () => {
      // 'close' always follows; pending calls are rejected there.
    })
    socket.on('close', () => this.onClosed())
  }

  get isClosed(): boolean {
    return this.closed
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new HelperRpcError(HelperClientErrorCode.disconnected, 'helper connection is closed'),
      )
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new HelperRpcError(HelperErrorCode.timeout, `${method} timed out after ${timeoutMs} ms`),
        )
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      this.socket.write(encodeRequest(id, method, params))
    })
  }

  close(): void {
    if (this.closed) return
    this.socket.end()
    setTimeout(() => this.socket.destroy(), 200).unref()
  }

  private onData(chunk: string): void {
    let lines: string[]
    try {
      lines = this.lines.push(chunk)
    } catch (error) {
      this.handlers.onInvalid?.(String(error))
      return
    }
    for (const line of lines) {
      const msg = classify(line)
      switch (msg.kind) {
        case 'notification':
          this.handlers.onNotification(msg.method, msg.params)
          break
        case 'response':
        case 'error': {
          const pending = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined
          if (!pending || typeof msg.id !== 'number') {
            if (msg.kind === 'error')
              this.handlers.onInvalid?.(`helper error without a matching call: ${msg.message}`)
            break
          }
          this.pending.delete(msg.id)
          clearTimeout(pending.timer)
          if (msg.kind === 'response') pending.resolve(msg.result)
          else pending.reject(new HelperRpcError(msg.code, msg.message, msg.data))
          break
        }
        case 'invalid':
          this.handlers.onInvalid?.(msg.reason)
          break
      }
    }
  }

  private onClosed(): void {
    if (this.closed) return
    this.closed = true
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(
        new HelperRpcError(
          HelperClientErrorCode.disconnected,
          `helper disconnected during ${p.method}`,
        ),
      )
      this.pending.delete(id)
    }
    this.handlers.onClose()
  }
}
