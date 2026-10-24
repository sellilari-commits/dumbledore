/**
 * Test-control channel for automated E2E (PLAN §6.9) — only started when DUMBLEDORE_TEST=1.
 *
 * JSON over HTTP on 127.0.0.1 (random port) with a random bearer token. Port and token are
 * written to <data dir>/run/test-control.json (0600). Requests must carry the token and a
 * loopback Host header (blocks DNS rebinding). Endpoints:
 *   GET  /health · /state/overlay · /state/session · /state/app · /state/frontmost · /state/windows
 *   POST /gesture {gesture, secureInput?} · /overlay/action {action, displayId?}
 *        /invoke {channel, payload} · /cancel · /key {key} (a quiz-card key, as forwarded)
 *        /fake/helper/event {event, payload} · /fake/helper/state {…} · /fake/perception {…}
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface TestControlApi {
  overlayState(): unknown
  session(): unknown
  appState(): unknown
  frontmost(): Promise<unknown>
  windows(): unknown
  gesture(body: unknown): Promise<unknown>
  overlayAction(body: unknown): Promise<unknown>
  invoke(body: unknown): Promise<unknown>
  cancel(): unknown
  key(body: unknown): unknown
  /** Present only while the fake helper / perception are in use. */
  fakeHelperEvent?: (body: unknown) => unknown
  fakeHelperState?: (body: unknown) => unknown
  fakePerception?: (body: unknown) => unknown
}

export interface TestControlInfo {
  port: number
  token: string
  pid: number
}

const MAX_BODY = 1 << 20

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve(undefined)
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'Body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

export class TestControlServer {
  private server: Server | null = null
  private readonly token = randomBytes(24).toString('hex')
  private port = 0

  constructor(
    private readonly api: TestControlApi,
    private readonly file: string,
  ) {}

  async start(): Promise<TestControlInfo> {
    const server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    const info: TestControlInfo = { port: this.port, token: this.token, pid: process.pid }
    writeFileSync(this.file, JSON.stringify(info), { mode: 0o600 })
    return info
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    rmSync(this.file, { force: true })
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private authorized(req: IncomingMessage): boolean {
    const host = req.headers.host ?? ''
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return false
    const given = Buffer.from(req.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${this.token}`)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body ?? null))
    }
    try {
      if (!this.authorized(req)) throw new HttpError(401, 'Unauthorized')
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const body = req.method === 'POST' ? await readBody(req) : undefined
      send(200, await this.route(req.method ?? 'GET', path, body))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400
      send(status, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async route(method: string, path: string, body: unknown): Promise<unknown> {
    const { api } = this
    const optional = (fn: ((b: unknown) => unknown) | undefined) => {
      if (!fn) throw new HttpError(404, `${path} needs the fake helper/perception`)
      return fn(body)
    }
    const key = `${method} ${path}`
    switch (key) {
      case 'GET /health':
        return { ok: true, pid: process.pid }
      case 'GET /state/overlay':
        return api.overlayState()
      case 'GET /state/session':
        return api.session()
      case 'GET /state/app':
        return api.appState()
      case 'GET /state/frontmost':
        return api.frontmost()
      case 'GET /state/windows':
        return api.windows()
      case 'POST /gesture':
        return api.gesture(body)
      case 'POST /overlay/action':
        return api.overlayAction(body)
      case 'POST /invoke':
        return api.invoke(body)
      case 'POST /cancel':
        return api.cancel()
      case 'POST /key':
        return api.key(body)
      case 'POST /fake/helper/event':
        return optional(api.fakeHelperEvent)
      case 'POST /fake/helper/state':
        return optional(api.fakeHelperState)
      case 'POST /fake/perception':
        return optional(api.fakePerception)
      default:
        throw new HttpError(404, `No route for ${key}`)
    }
  }
}
