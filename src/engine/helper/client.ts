/**
 * SocketHelperClient — the real HelperClient: talks JSON-RPC to the Swift helper over its socket.
 *
 * Lifecycle: start() adopts a helper already listening on the socket (same protocol version) or
 * launches one, then pings it. When the connection drops it reconnects with exponential backoff
 * (and re-sends `shortcut.configure`, which lives in helper memory). Params and results are
 * validated with the zod schemas of @shared/helper-protocol; events are validated before delivery.
 * start() resolves after the first attempt either way — watch `status` / onStatus().
 */
import { existsSync } from 'node:fs'
import type { Socket } from 'node:net'
import {
  HELPER_PROTOCOL_VERSION,
  HelperErrorCode,
  type HelperEvent,
  type HelperEventPayload,
  type HelperMethod,
  type HelperParams,
  type HelperResult,
  helperMethods,
} from '@shared/helper-protocol'
import type { z } from 'zod'
import type { HelperClient, HelperStatus } from '../contracts'
import { connectSocket, HelperConnection } from './connection'
import { HelperClientErrorCode, HelperRpcError, isHelperRpcError } from './errors'
import { HelperEventHub } from './events'
import {
  defaultSocketPath,
  HELPER_EXIT_ALREADY_RUNNING,
  type HelperLauncher,
  type LaunchedHelper,
  type LogFn,
  MAX_SOCKET_PATH_BYTES,
} from './launcher'

export interface SocketHelperClientOptions {
  launcher: HelperLauncher
  socketPath?: string
  log?: LogFn
  /** How long to wait for a launched helper to open its socket. Default 10 s. */
  connectTimeoutMs?: number
  /** Per-method call timeouts (ms); `defaultTimeoutMs` for the rest (3 s). */
  timeouts?: Partial<Record<HelperMethod, number>>
  defaultTimeoutMs?: number
  restart?: { initialDelayMs?: number; maxDelayMs?: number; stableAfterMs?: number }
  /** Terminate the helper on stop(). Default: true unless the launcher is external. */
  killOnStop?: boolean
}

const DEFAULT_TIMEOUTS: Partial<Record<HelperMethod, number>> = {
  perceive: 10_000,
  'ax.findChatInput': 8_000,
  'input.write': 6_000,
  'permissions.request': 6_000,
  'llm.onDevice.generate': 120_000,
}

/** Calls whose effect lives in helper memory and must be replayed after a restart. */
const STICKY: ReadonlySet<HelperMethod> = new Set<HelperMethod>(['shortcut.configure'])

type Spec = { params: z.ZodType; result: z.ZodType }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class SocketHelperClient implements HelperClient {
  private conn: HelperConnection | null = null
  private launched: LaunchedHelper | null = null
  private helperPid: number | null = null
  private wanted = false
  private attempting: Promise<void> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private connectedAt = 0
  private timeoutsInARow = 0
  private readonly sticky = new Map<HelperMethod, unknown>()
  private readonly hub: HelperEventHub
  private readonly socketPath: string
  private readonly log: LogFn

  constructor(private readonly opts: SocketHelperClientOptions) {
    this.socketPath = opts.socketPath ?? defaultSocketPath()
    if (Buffer.byteLength(this.socketPath) > MAX_SOCKET_PATH_BYTES) {
      throw new Error(
        `helper socket path is too long for macOS (${MAX_SOCKET_PATH_BYTES} bytes max): ${this.socketPath}`,
      )
    }
    this.log = opts.log ?? (() => {})
    this.hub = new HelperEventHub(this.log)
  }

  get status(): HelperStatus {
    return this.hub.status
  }

  /** Process id of the connected helper (from ping), or null. */
  get pid(): number | null {
    return this.helperPid
  }

  async start(): Promise<void> {
    if (this.wanted) return this.attempting ?? undefined
    this.wanted = true
    await this.attempt()
  }

  async stop(): Promise<void> {
    this.wanted = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const conn = this.conn
    this.conn = null
    conn?.close()
    const killOnStop = this.opts.killOnStop ?? this.opts.launcher.kind !== 'external'
    if (this.launched) this.launched.kill('SIGTERM')
    else if (killOnStop && this.helperPid) killQuietly(this.helperPid)
    this.launched = null
    this.helperPid = null
    this.setStatus('down')
  }

  async call<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    opts?: { timeoutMs?: number },
  ): Promise<HelperResult<M>> {
    const spec = helperMethods[method] as unknown as Spec
    const parsed = spec.params.safeParse(params ?? {})
    if (!parsed.success) {
      throw new HelperRpcError(
        HelperErrorCode.invalidParams,
        `invalid ${method} params`,
        parsed.error.issues,
      )
    }
    const conn = this.conn
    if (!conn || this.status !== 'connected') {
      throw new HelperRpcError(HelperClientErrorCode.notConnected, `helper is ${this.status}`)
    }
    if (STICKY.has(method)) this.sticky.set(method, parsed.data)
    const timeoutMs =
      opts?.timeoutMs ??
      this.opts.timeouts?.[method] ??
      DEFAULT_TIMEOUTS[method] ??
      this.opts.defaultTimeoutMs ??
      3_000
    let raw: unknown
    try {
      raw = await conn.request(method, parsed.data, timeoutMs)
      this.timeoutsInARow = 0
    } catch (error) {
      if (isHelperRpcError(error) && error.isTimeout && ++this.timeoutsInARow >= 3)
        this.recycle('3 calls timed out in a row')
      throw error
    }
    const result = spec.result.safeParse(raw)
    if (!result.success) {
      throw new HelperRpcError(
        HelperClientErrorCode.invalidResult,
        `invalid ${method} result from helper`,
        result.error.issues,
      )
    }
    return result.data as HelperResult<M>
  }

  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    return this.hub.on(event, listener)
  }

  onStatus(listener: (status: HelperStatus) => void): () => void {
    return this.hub.onStatus(listener)
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────────────────────────

  private attempt(): Promise<void> {
    if (this.attempting) return this.attempting
    this.attempting = this.connectOnce()
      .catch((error: unknown) => {
        this.log(
          'warn',
          `helper start failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (this.wanted) {
          this.setStatus('down')
          this.scheduleRestart()
        }
      })
      .finally(() => {
        this.attempting = null
      })
    return this.attempting
  }

  private async connectOnce(): Promise<void> {
    this.setStatus('starting')
    if (await this.tryAdopt()) return
    if (!this.wanted) throw new Error('stopped')
    const launched = await this.opts.launcher.launch(this.socketPath)
    this.launched = launched
    let exitCode: number | null | undefined
    void launched.exited?.then((code) => {
      exitCode = code
    })
    const deadline = Date.now() + (this.opts.connectTimeoutMs ?? 10_000)
    while (Date.now() < deadline) {
      if (!this.wanted) {
        launched.kill()
        throw new Error('stopped')
      }
      if (exitCode !== undefined && exitCode !== HELPER_EXIT_ALREADY_RUNNING) {
        this.launched = null
        throw new Error(`helper exited with code ${exitCode}`)
      }
      if (exitCode === HELPER_EXIT_ALREADY_RUNNING) this.launched = null
      const socket = await connectSocket(this.socketPath, 500).catch(() => null)
      if (socket) {
        const conn = this.wrap(socket)
        const ping = await this.ping(conn)
        if (ping.version !== HELPER_PROTOCOL_VERSION) {
          conn.close()
          launched.kill()
          throw new Error(
            `helper speaks protocol ${ping.version}, expected ${HELPER_PROTOCOL_VERSION}`,
          )
        }
        this.adopt(conn, ping.pid)
        return
      }
      await sleep(100)
    }
    launched.kill()
    this.launched = null
    throw new Error('helper did not open its socket in time')
  }

  /** Reuses a helper that already listens on the socket; stops one with another protocol version. */
  private async tryAdopt(): Promise<boolean> {
    if (!existsSync(this.socketPath)) return false
    const socket = await connectSocket(this.socketPath, 500).catch(() => null)
    if (!socket) return false
    const conn = this.wrap(socket)
    const ping = await this.ping(conn).catch(() => null)
    if (ping && ping.version === HELPER_PROTOCOL_VERSION) {
      this.log('info', `using the helper that is already running (pid ${ping.pid})`)
      this.adopt(conn, ping.pid)
      return true
    }
    conn.close()
    if (ping) {
      this.log(
        'warn',
        `stopping helper pid ${ping.pid}: protocol ${ping.version} ≠ ${HELPER_PROTOCOL_VERSION}`,
      )
      killQuietly(ping.pid)
      for (let i = 0; i < 20 && existsSync(this.socketPath); i++) await sleep(100)
    }
    return false
  }

  private async ping(conn: HelperConnection): Promise<HelperResult<'ping'>> {
    const raw = await conn.request('ping', {}, 3_000)
    return helperMethods.ping.result.parse(raw)
  }

  private wrap(socket: Socket): HelperConnection {
    const conn: HelperConnection = new HelperConnection(socket, {
      onNotification: (method, params) => this.dispatch(method, params),
      onClose: () => this.onClosed(conn),
      onInvalid: (reason) => this.log('warn', `helper sent an invalid message: ${reason}`),
    })
    return conn
  }

  private adopt(conn: HelperConnection, pid: number): void {
    this.conn = conn
    this.helperPid = pid
    this.connectedAt = Date.now()
    this.timeoutsInARow = 0
    this.setStatus('connected')
    for (const [method, params] of this.sticky) {
      conn.request(method, params, 3_000).catch((error: unknown) => {
        this.log('warn', `could not restore ${method}: ${String(error)}`)
      })
    }
  }

  private onClosed(conn: HelperConnection): void {
    if (this.conn !== conn) return
    this.conn = null
    this.launched = null
    if (!this.wanted) return
    this.log('warn', 'helper connection closed; restarting')
    this.setStatus('down')
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (!this.wanted || this.restartTimer) return
    const r = this.opts.restart ?? {}
    if (this.connectedAt && Date.now() - this.connectedAt > (r.stableAfterMs ?? 60_000))
      this.attempts = 0
    const delay = Math.min(r.maxDelayMs ?? 15_000, (r.initialDelayMs ?? 500) * 2 ** this.attempts)
    this.attempts++
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.wanted) void this.attempt()
    }, delay)
    this.restartTimer.unref?.()
  }

  /** Kills a hung helper; the closed connection triggers the normal restart path. */
  private recycle(reason: string): void {
    this.log('error', `restarting the helper: ${reason}`)
    this.timeoutsInARow = 0
    if (this.launched) this.launched.kill('SIGKILL')
    else if (this.helperPid) killQuietly(this.helperPid, 'SIGKILL')
    this.conn?.close()
  }

  private dispatch(method: string, params: unknown): void {
    if (method === 'helper.log') {
      const p = params as Partial<HelperEventPayload<'helper.log'>>
      if (typeof p.message === 'string') this.log(p.level ?? 'info', `helper: ${p.message}`)
    }
    this.hub.dispatch(method, params)
  }

  private setStatus(status: HelperStatus): void {
    this.hub.setStatus(status)
  }
}

function killQuietly(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    process.kill(pid, signal)
  } catch {
    // already gone
  }
}
