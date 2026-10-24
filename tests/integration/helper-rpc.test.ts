/**
 * JSON-RPC robustness of the real helper, spoken raw over its Unix socket (no client library):
 * malformed lines, non-object and invalid requests, unknown methods, invalid params, id echoing,
 * pipelined / split / CRLF lines, over-long lines and several clients at once. Only methods
 * without side effects are called successfully; input methods only ever get invalid params.
 * Skips when the helper is not built (bash native/helper/build.sh).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELPER_PROTOCOL_VERSION, HelperErrorCode } from '@shared/helper-protocol'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const HELPER = fileURLToPath(
  new URL('../../native/helper/build/dumbledore-helper', import.meta.url),
)

type Msg = {
  id?: unknown
  result?: Record<string, unknown>
  error?: { code: number; message: string }
  method?: string
}

/** Newline-framed raw socket: send any text, read parsed lines (notifications are skipped). */
class RawClient {
  private buffer = ''
  private readonly lines: Msg[] = []
  private wake: (() => void) | null = null

  private constructor(readonly socket: Socket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      for (let nl = this.buffer.indexOf('\n'); nl >= 0; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        const msg = JSON.parse(line) as Msg
        if (!('method' in msg)) this.lines.push(msg)
      }
      this.wake?.()
    })
  }

  static connect(path: string): Promise<RawClient> {
    return new Promise((resolve, reject) => {
      const s = createConnection({ path }, () => resolve(new RawClient(s)))
      s.once('error', reject)
    })
  }

  write(text: string): void {
    this.socket.write(text)
  }

  send(msg: unknown): void {
    this.write(`${JSON.stringify(msg)}\n`)
  }

  async next(timeoutMs = 3000): Promise<Msg> {
    const end = Date.now() + timeoutMs
    while (this.lines.length === 0) {
      if (Date.now() > end) throw new Error('no response from the helper')
      await new Promise<void>((resolve) => {
        this.wake = resolve
        setTimeout(resolve, 50)
      })
    }
    return this.lines.shift() as Msg
  }

  /** Responses to `count` requests, in any order, keyed by id. */
  async collect(count: number): Promise<Map<unknown, Msg>> {
    const out = new Map<unknown, Msg>()
    while (out.size < count) {
      const m = await this.next()
      out.set(m.id, m)
    }
    return out
  }

  async call(method: string, params?: unknown, id: unknown = 1): Promise<Msg> {
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    return this.next()
  }

  close(): void {
    this.socket.destroy()
  }
}

let dir: string
let socketPath: string
let helper: ChildProcess
let helperPid = 0
const clients: RawClient[] = []

async function connect(): Promise<RawClient> {
  const c = await RawClient.connect(socketPath)
  clients.push(c)
  return c
}

describe.skipIf(!existsSync(HELPER))('helper JSON-RPC over the socket', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dh-rpc-'))
    socketPath = join(dir, 'helper.sock')
    helper = spawn(HELPER, ['serve', '--socket', socketPath, '--parent-pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const ready = await new Promise<{ pid: number; protocol: number }>((resolve, reject) => {
      let out = ''
      helper.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
        out += chunk
        if (out.includes('\n')) resolve(JSON.parse(out.split('\n')[0] ?? '{}'))
      })
      helper.once('exit', (code) => reject(new Error(`helper exited early (${code})`)))
      setTimeout(() => reject(new Error('helper did not report ready')), 10_000)
    })
    expect(ready.protocol).toBe(HELPER_PROTOCOL_VERSION)
    helperPid = ready.pid
  }, 15_000)

  afterEach(() => {
    for (const c of clients.splice(0)) c.close()
  })

  afterAll(() => {
    helper?.kill('SIGTERM')
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers ping with version, pid and permissions', async () => {
    const c = await connect()
    const r = await c.call('ping')
    expect(r).toMatchObject({ id: 1, result: { version: HELPER_PROTOCOL_VERSION, pid: helperPid } })
    expect(r.result?.permissions).toEqual({
      accessibility: expect.any(Boolean),
      screenRecording: expect.any(Boolean),
    })
  })

  it('answers a malformed line with a parse error and keeps the connection', async () => {
    const c = await connect()
    c.write('{"jsonrpc":"2.0","id":1,"method":"ping"\n')
    expect(await c.next()).toMatchObject({ id: null, error: { code: HelperErrorCode.parse } })
    c.write('\u0000ÿ garbage\n')
    expect(await c.next()).toMatchObject({ id: null, error: { code: HelperErrorCode.parse } })
    expect(await c.call('ping', undefined, 2)).toMatchObject({ id: 2, result: { pid: helperPid } })
  })

  it('rejects batches, non-objects and requests without jsonrpc 2.0 or a method', async () => {
    const c = await connect()
    const invalid = { code: HelperErrorCode.invalidRequest }
    c.write('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n')
    expect(await c.next()).toMatchObject({
      id: null,
      error: { ...invalid, message: expect.stringContaining('batch') },
    })
    c.write('42\n') // a bare value: parse error or invalid request, depending on the JSON parser
    expect([HelperErrorCode.parse, HelperErrorCode.invalidRequest]).toContain(
      (await c.next()).error?.code,
    )
    c.send({ id: 5, method: 'ping' })
    expect(await c.next()).toMatchObject({ id: 5, error: invalid })
    c.send({ jsonrpc: '1.0', id: 6, method: 'ping' })
    expect(await c.next()).toMatchObject({ id: 6, error: invalid })
    c.send({ jsonrpc: '2.0', id: 7, method: '' })
    expect(await c.next()).toMatchObject({ id: 7, error: invalid })
  })

  it('reports unknown methods, and stays silent for unknown notifications', async () => {
    const c = await connect()
    expect(await c.call('no.such.method', {}, 8)).toMatchObject({
      id: 8,
      error: { code: HelperErrorCode.methodNotFound, message: 'method not found: no.such.method' },
    })
    c.send({ jsonrpc: '2.0', method: 'no.such.notification', params: {} })
    expect(await c.call('ping', undefined, 9)).toMatchObject({ id: 9 })
  })

  it('rejects invalid params with -32602 and a useful message', async () => {
    const c = await connect()
    const cases: [string, unknown, string][] = [
      ['input.key', {}, 'params.combo is required'],
      ['input.click', { x: 'left', y: 1 }, 'params.x'],
      ['permissions.request', { kind: 'camera' }, 'params.kind'],
      ['perceive', { scope: 'everything' }, 'params.scope'],
      ['ax.findChatInput', { pid: 'front' }, 'params.pid'],
      ['input.write', { mode: 'insert' }, 'params.text is required'],
      ['ax.findChatInput', 'not an object', 'params'],
      [
        'shortcut.configure',
        { key: 'rightOption', tapMaxMs: 0, holdMinMs: 300, doubleTapMs: 250, enabled: false },
        'durations must be positive',
      ],
    ]
    for (const [i, [method, params, message]] of cases.entries()) {
      const r = await c.call(method, params, 100 + i)
      expect(r, method).toMatchObject({
        id: 100 + i,
        error: { code: HelperErrorCode.invalidParams, message: expect.stringContaining(message) },
      })
    }
  })

  it('echoes string and large numeric ids', async () => {
    const c = await connect()
    expect(await c.call('ping', {}, 'req-ä-1')).toMatchObject({ id: 'req-ä-1' })
    expect(await c.call('ping', {}, 2 ** 40 + 7)).toMatchObject({ id: 2 ** 40 + 7 })
  })

  it('handles pipelined, split and CRLF-terminated requests', async () => {
    const c = await connect()
    const req = (id: number, method = 'ping') => JSON.stringify({ jsonrpc: '2.0', id, method })
    c.write(`${req(1)}\n${req(2, 'system.idle')}\n\n${req(3, 'permissions.status')}\n`)
    const first = await c.collect(3)
    expect([...first.keys()].sort()).toEqual([1, 2, 3])
    expect(first.get(2)?.result).toEqual({ seconds: expect.any(Number) })
    const split = req(4)
    c.write(split.slice(0, 10))
    await new Promise((r) => setTimeout(r, 80))
    c.write(`${split.slice(10)}\r\n`)
    expect(await c.next()).toMatchObject({ id: 4, result: { pid: helperPid } })
  })

  it('skips a 1 MB junk line quickly and keeps serving', async () => {
    const c = await connect()
    const started = Date.now()
    c.write(
      `${'x'.repeat(1024 * 1024)}\n${JSON.stringify({ jsonrpc: '2.0', id: 76, method: 'ping' })}\n`,
    )
    expect(await c.next(5000)).toMatchObject({ id: null, error: { code: HelperErrorCode.parse } })
    expect(await c.next(5000)).toMatchObject({ id: 76 })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  // The reader rescans its whole buffer for a newline after every read, so one line costs O(n²):
  // 4 MB ≈ 3.4 s, 8 MB ≈ 14 s, 17 MB > 1 min on this Mac (reported in L1b-helper-tests.md).
  it.skipIf(process.env.DUMBLEDORE_SLOW !== '1')(
    'drops an over-long line (> 16 MB) and keeps serving',
    async () => {
      const c = await connect()
      c.write('x'.repeat(17 * 1024 * 1024))
      c.write(`\n${JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'ping' })}\n`)
      const seen: Msg[] = []
      while (!seen.some((m) => m.id === 77)) seen.push(await c.next(170_000))
      expect(seen.some((m) => m.error?.message === 'line too long')).toBe(true)
    },
    180_000,
  )

  it('serves several clients independently', async () => {
    const [a, b] = await Promise.all([connect(), connect()])
    a.send({ jsonrpc: '2.0', id: 'a', method: 'system.displays' })
    b.send({ jsonrpc: '2.0', id: 'b', method: 'ping' })
    expect((await a.next()).id).toBe('a')
    expect((await b.next()).id).toBe('b')
    a.close()
    expect(await b.call('ping', {}, 'b2')).toMatchObject({ id: 'b2' })
  })
})
