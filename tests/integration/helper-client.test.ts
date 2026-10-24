/**
 * SocketHelperClient (src/engine/helper) against the real helper binary: start + ping, the
 * read-only system methods validated by the protocol's zod schemas, client- and helper-side
 * invalid params, reconnecting after the helper is killed, adopting a running helper and stopping
 * it. Skips when the helper is not built (bash native/helper/build.sh).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  externalLauncher,
  type HelperRpcError,
  isHelperRpcError,
  SocketHelperClient,
  spawnLauncher,
} from '@engine/helper'
import { HELPER_PROTOCOL_VERSION, HelperErrorCode } from '@shared/helper-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HELPER = fileURLToPath(
  new URL('../../native/helper/build/dumbledore-helper', import.meta.url),
)

let dir: string
let socketPath: string
const clients: SocketHelperClient[] = []
const logs: string[] = []

function client(kind: 'spawn' | 'external' = 'spawn'): SocketHelperClient {
  const c = new SocketHelperClient({
    launcher: kind === 'spawn' ? spawnLauncher({ executable: HELPER }) : externalLauncher(),
    socketPath,
    connectTimeoutMs: 10_000,
    restart: { initialDelayMs: 100, maxDelayMs: 400 },
    log: (level, message) => logs.push(`${level}: ${message}`),
  })
  clients.push(c)
  return c
}

async function until(cond: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`condition not met in ${ms} ms; log:\n${logs.join('\n')}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function rpcError(p: Promise<unknown>): Promise<HelperRpcError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  )
  if (!isHelperRpcError(error)) throw new Error(`expected a HelperRpcError, got ${String(error)}`)
  return error
}

describe.skipIf(!existsSync(HELPER))('SocketHelperClient with the real helper', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dh-cli-'))
    socketPath = join(dir, 'helper.sock')
    logs.length = 0
  })

  afterEach(async () => {
    for (const c of clients.splice(0).reverse()) await c.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('launches the helper and connects', async () => {
    const c = client()
    const statuses: string[] = []
    c.onStatus((s) => statuses.push(s))
    await c.start()
    expect(c.status).toBe('connected')
    expect(statuses).toEqual(['starting', 'connected'])
    expect(c.pid).toBeGreaterThan(0)
    const ping = await c.call('ping', {})
    expect(ping.version).toBe(HELPER_PROTOCOL_VERSION)
    expect(ping.pid).toBe(c.pid)
  })

  it('answers the read-only system methods with valid results', async () => {
    const c = client()
    await c.start()
    const { permissions } = await c.call('ping', {})
    expect(await c.call('permissions.status', {})).toEqual(permissions)

    const { displays } = await c.call('system.displays', {})
    expect(displays.length).toBeGreaterThan(0)
    expect(displays.filter((d) => d.isMain)).toHaveLength(1)
    expect(displays.some((d) => d.frame.x === 0 && d.frame.y === 0)).toBe(true) // menu-bar screen
    for (const d of displays) {
      expect(d.scale).toBeGreaterThanOrEqual(1)
      expect(d.frame.width).toBeGreaterThan(0)
      expect(d.visibleFrame.width).toBeLessThanOrEqual(d.frame.width)
      expect(d.visibleFrame.height).toBeLessThanOrEqual(d.frame.height)
    }

    const idle = await c.call('system.idle', {})
    expect(idle.seconds).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(idle.seconds)).toBe(true)

    const onDevice = await c.call('llm.onDevice.status', {})
    expect(typeof onDevice.available).toBe('boolean')
    if (!onDevice.available) expect(onDevice.reason).toEqual(expect.any(String))
    await c.call('frontmost', {}) // null or a valid FrontmostInfo (the client validates the shape)
  })

  it('rejects invalid params before they reach the helper', async () => {
    const c = client()
    await c.start()
    const error = await rpcError(c.call('input.key', {} as never))
    expect(error.code).toBe(HelperErrorCode.invalidParams)
    expect(error.message).toBe('invalid input.key params')
    expect(c.status).toBe('connected')
  })

  it('passes helper-side errors through with their code', async () => {
    const c = client()
    await c.start()
    const error = await rpcError(
      c.call('shortcut.configure', {
        key: 'rightOption',
        tapMaxMs: 0,
        holdMinMs: 350,
        doubleTapMs: 300,
        enabled: false,
      }),
    )
    expect(error.code).toBe(HelperErrorCode.invalidParams)
    expect(error.message).toContain('durations must be positive')
    expect((await c.call('ping', {})).pid).toBe(c.pid)
  })

  it('restarts and reconnects after the helper process is killed', async () => {
    const c = client()
    const statuses: string[] = []
    c.onStatus((s) => statuses.push(s))
    await c.start()
    const first = c.pid ?? 0
    process.kill(first, 'SIGKILL')
    await until(() => statuses.includes('down'))
    const notConnected = await rpcError(c.call('ping', {}))
    expect(notConnected.isConnectionError).toBe(true)
    await until(() => c.status === 'connected' && c.pid !== first)
    expect(alive(first)).toBe(false)
    expect((await c.call('ping', {})).pid).toBe(c.pid)
    expect(statuses.slice(0, 2)).toEqual(['starting', 'connected'])
    expect(statuses.at(-1)).toBe('connected')
  })

  it('adopts a helper that is already running instead of launching another', async () => {
    const owner = client()
    await owner.start()
    const guest = client('external')
    await guest.start()
    expect(guest.status).toBe('connected')
    expect(guest.pid).toBe(owner.pid)
    await guest.stop() // an external client never kills the helper
    expect((await owner.call('ping', {})).pid).toBe(owner.pid)
  })

  it('terminates the helper it launched on stop()', async () => {
    const c = client()
    await c.start()
    const pid = c.pid ?? 0
    await c.stop()
    expect(c.status).toBe('down')
    await until(() => !alive(pid), 5000)
    await until(() => !existsSync(socketPath), 5000)
  })
})
