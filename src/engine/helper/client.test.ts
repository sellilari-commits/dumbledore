import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HelperErrorCode } from '@shared/helper-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SocketHelperClient } from './client'
import { HelperClientErrorCode, HelperRpcError } from './errors'
import { externalLauncher, spawnLauncher } from './launcher'
import { type MockHelperServer, startMockHelperServer } from './testing/mock-server'

let dir: string
let server: MockHelperServer | null = null
let client: SocketHelperClient | null = null

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dh-'))
})

afterEach(async () => {
  await client?.stop()
  await server?.close()
  client = null
  server = null
  rmSync(dir, { recursive: true, force: true })
})

function external(socketPath: string, logs: string[] = []): SocketHelperClient {
  return new SocketHelperClient({
    launcher: externalLauncher(),
    socketPath,
    connectTimeoutMs: 600,
    restart: { initialDelayMs: 20, maxDelayMs: 100 },
    log: (level, message) => logs.push(`${level}:${message}`),
  })
}

describe('SocketHelperClient', () => {
  it('connects to a running helper and validates calls', async () => {
    server = await startMockHelperServer(join(dir, 'h.sock'))
    client = external(server.path)
    const statuses: string[] = []
    client.onStatus((s) => statuses.push(s))
    await client.start()
    expect(client.status).toBe('connected')
    expect(statuses).toEqual(['starting', 'connected'])
    expect(client.pid).toBe(999_999)
    expect(await client.call('permissions.status', {})).toEqual({
      accessibility: true,
      screenRecording: true,
    })
    await client.call('perceive', { scope: 'frontmost' })
    expect(server.received.at(-1)).toEqual({
      method: 'perceive',
      params: {
        scope: 'frontmost',
        minChange: 6,
        allowOcr: true,
        forceOcr: false,
        maxChars: 20000,
        excludeBundleIds: [],
      },
    })
  })

  it('surfaces helper errors, invalid results, bad params and timeouts', async () => {
    server = await startMockHelperServer(join(dir, 'h.sock'))
    server.fail('input.write', HelperErrorCode.secureInput, 'password field')
    server.respond('system.idle', () => ({ seconds: 'later' }))
    server.silence('frontmost')
    client = external(server.path)
    await client.start()
    const write = await client
      .call('input.write', { text: 'x', mode: 'insert', target: null, expectPid: null })
      .catch((e: unknown) => e)
    expect(write).toBeInstanceOf(HelperRpcError)
    expect((write as HelperRpcError).isSecureInput).toBe(true)
    await expect(client.call('system.idle', {})).rejects.toMatchObject({
      code: HelperClientErrorCode.invalidResult,
    })
    // @ts-expect-error invalid params on purpose
    await expect(client.call('input.key', { combo: 3 })).rejects.toMatchObject({
      code: HelperErrorCode.invalidParams,
    })
    await expect(client.call('frontmost', {}, { timeoutMs: 50 })).rejects.toMatchObject({
      code: HelperErrorCode.timeout,
    })
  })

  it('delivers valid events only and forwards helper.log', async () => {
    server = await startMockHelperServer(join(dir, 'h.sock'))
    const logs: string[] = []
    client = external(server.path, logs)
    await client.start()
    const gestures: string[] = []
    client.on('key.trigger', (p) => gestures.push(p.gesture))
    server.notify('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: false })
    server.notify('key.trigger', { gesture: 'nope', key: 'rightOption', secureInput: false })
    server.notify('made.up', {})
    server.notify('helper.log', { level: 'warn', message: 'careful' })
    await waitFor(() => logs.some((l) => l.includes('careful')))
    expect(gestures).toEqual(['tap'])
    expect(logs).toContain('warn:helper: careful')
    expect(logs.some((l) => l.includes('invalid key.trigger'))).toBe(true)
  })

  it('reconnects after the connection drops and restores the shortcut config', async () => {
    server = await startMockHelperServer(join(dir, 'h.sock'))
    client = external(server.path)
    await client.start()
    const shortcut = {
      key: 'rightOption',
      tapMaxMs: 350,
      holdMinMs: 500,
      doubleTapMs: 300,
      enabled: true,
    } as const
    await client.call('shortcut.configure', shortcut)
    const statuses: string[] = []
    client.onStatus((s) => statuses.push(s))
    server.dropConnections()
    await waitFor(() => statuses.includes('down'))
    await expect(client.call('ping', {})).rejects.toMatchObject({
      code: HelperClientErrorCode.notConnected,
    })
    await waitFor(() => client?.status === 'connected')
    await waitFor(
      () => server?.received.filter((r) => r.method === 'shortcut.configure').length === 2,
    )
    expect(statuses).toEqual(['down', 'starting', 'connected'])
  })

  it('stays down (and keeps retrying) when nothing listens', async () => {
    client = external(join(dir, 'missing.sock'))
    await client.start()
    expect(client.status).toBe('down')
    await expect(client.call('ping', {})).rejects.toMatchObject({
      code: HelperClientErrorCode.notConnected,
    })
    server = await startMockHelperServer(join(dir, 'missing.sock'))
    await waitFor(() => client?.status === 'connected')
  })

  it('refuses socket paths macOS cannot bind', () => {
    expect(() => external(join(dir, 'x'.repeat(120)))).toThrow(/too long/)
  })

  it('spawns the helper, restarts it after a crash and kills it on stop', async () => {
    const socketPath = join(dir, 's.sock')
    const script = join(dir, 'fake-helper.mjs')
    writeFileSync(script, FAKE_HELPER_SCRIPT(process.execPath))
    chmodSync(script, 0o755)
    const pids: number[] = []
    client = new SocketHelperClient({
      launcher: spawnLauncher({ executable: script }),
      socketPath,
      restart: { initialDelayMs: 20, maxDelayMs: 100 },
    })
    await client.start()
    expect(client.status).toBe('connected')
    pids.push(client.pid ?? 0)
    process.kill(pids[0] ?? 0, 'SIGKILL')
    await waitFor(() => client?.status === 'down')
    await waitFor(() => client?.status === 'connected' && client.pid !== pids[0], 5000)
    pids.push(client.pid ?? 0)
    expect(pids[1]).not.toBe(pids[0])
    await client.stop()
    await waitFor(() => !isAlive(pids[1] ?? 0))
    expect(client.status).toBe('down')
  })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A minimal helper in plain Node: answers ping with its own pid. */
const FAKE_HELPER_SCRIPT = (node: string) => `#!${node}
import net from 'node:net'
import fs from 'node:fs'
const path = process.argv[process.argv.indexOf('--socket') + 1]
if (fs.existsSync(path)) fs.unlinkSync(path)
const server = net.createServer((s) => {
  let buf = ''
  s.setEncoding('utf8')
  s.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
      const result = req.method === 'ping'
        ? { version: 1, pid: process.pid, permissions: { accessibility: false, screenRecording: false } }
        : {}
      s.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n')
    }
  })
  s.on('error', () => {})
})
server.listen(path)
process.on('SIGTERM', () => { server.close(); process.exit(0) })
`
