/**
 * An in-process stand-in for the Swift helper's socket server, for client tests: answers JSON-RPC
 * with protocol defaults (or scripted results), pushes notifications and can drop connections to
 * simulate a crash. Not used in production code.
 */
import { existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { HELPER_PROTOCOL_VERSION, type HelperMethod } from '@shared/helper-protocol'
import { defaultResult } from '../fixtures'
import { LineBuffer } from '../framing'

type Handler = (params: unknown) => unknown

export interface MockHelperServer {
  readonly path: string
  readonly received: { method: string; params: unknown }[]
  connectionCount(): number
  /** Scripted result for every call of `method`. */
  respond(method: string, handler: Handler): void
  /** Replies with a JSON-RPC error instead. */
  fail(method: string, code: number, message: string): void
  /** Never answers `method` (to test timeouts). */
  silence(method: string): void
  notify(method: string, params: unknown): void
  /** Closes every client connection but keeps listening (a crash + instant restart). */
  dropConnections(): void
  close(): Promise<void>
}

export async function startMockHelperServer(
  path: string,
  opts: { version?: number; pid?: number } = {},
): Promise<MockHelperServer> {
  if (existsSync(path)) unlinkSync(path)
  const sockets = new Set<Socket>()
  const handlers = new Map<string, Handler>()
  const errors = new Map<string, { code: number; message: string }>()
  const silent = new Set<string>()
  const received: { method: string; params: unknown }[] = []
  handlers.set('ping', () => ({
    version: opts.version ?? HELPER_PROTOCOL_VERSION,
    pid: opts.pid ?? 999_999,
    permissions: { accessibility: true, screenRecording: false },
  }))

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    const lines = new LineBuffer()
    socket.on('data', (chunk: string) => {
      for (const line of lines.push(chunk)) {
        const req = JSON.parse(line) as { id: number; method: string; params: unknown }
        received.push({ method: req.method, params: req.params })
        if (silent.has(req.method)) continue
        const err = errors.get(req.method)
        const reply = err
          ? { jsonrpc: '2.0', id: req.id, error: { ...err, data: null } }
          : {
              jsonrpc: '2.0',
              id: req.id,
              result:
                handlers.get(req.method)?.(req.params) ?? defaultResult(req.method as HelperMethod),
            }
        socket.write(`${JSON.stringify(reply)}\n`)
      }
    })
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve())
  })

  return {
    path,
    received,
    connectionCount: () => sockets.size,
    respond: (method, handler) => {
      handlers.set(method, handler)
    },
    fail: (method, code, message) => {
      errors.set(method, { code, message })
    },
    silence: (method) => {
      silent.add(method)
    },
    notify: (method, params) => {
      for (const s of sockets) s.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
    dropConnections: () => {
      for (const s of sockets) s.destroy()
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}
