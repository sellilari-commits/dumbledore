/**
 * Process lifecycle of the real helper: CLI commands, socket file permissions, refusing a second
 * helper on a live socket, replacing a stale socket after a crash, clean SIGTERM shutdown and
 * exiting with the engine (--parent-pid). Skips when the helper is not built.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELPER_PROTOCOL_VERSION } from '@shared/helper-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HELPER = fileURLToPath(
  new URL('../../native/helper/build/dumbledore-helper', import.meta.url),
)
const EXIT_ALREADY_RUNNING = 75

interface Started {
  child: ChildProcess
  /** Resolves with the ready line ({ pid, protocol }) or null when the process exits first. */
  ready: Promise<{ pid: number; protocol: number } | null>
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>
}

const children: ChildProcess[] = []
let dir: string

function start(socketPath: string, parentPid: number = process.pid): Started {
  const child = spawn(
    HELPER,
    ['serve', '--socket', socketPath, '--parent-pid', String(parentPid)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  children.push(child)
  let stderr = ''
  child.stderr?.setEncoding('utf8').on('data', (d: string) => {
    stderr += d
  })
  const exited = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stderr: string
  }>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal, stderr })))
  const ready = new Promise<{ pid: number; protocol: number } | null>((resolve) => {
    let out = ''
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      out += d
      if (out.includes('\n')) resolve(JSON.parse(out.split('\n')[0] ?? 'null'))
    })
    void exited.then(() => resolve(null))
  })
  return { child, ready, exited }
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(HELPER, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout,
        stderr,
      })
    })
  })
}

function ping(socketPath: string): Promise<{ pid: number }> {
  return new Promise((resolve, reject) => {
    const s = createConnection({ path: socketPath })
    let buf = ''
    s.setEncoding('utf8')
    s.on('connect', () => s.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n'))
    s.on('data', (d: string) => {
      buf += d
      for (const line of buf.split('\n').slice(0, -1)) {
        const msg = JSON.parse(line) as { id?: number; result?: { pid: number } }
        if (msg.id === 1 && msg.result) {
          s.destroy()
          resolve(msg.result)
        }
      }
    })
    s.once('error', reject)
    setTimeout(() => reject(new Error('ping timed out')), 3000)
  })
}

const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(what)), ms))])

describe.skipIf(!existsSync(HELPER))('helper process lifecycle', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dh-proc-'))
  })

  afterEach(() => {
    for (const c of children.splice(0))
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  })

  it('prints its version, passes its selftest and rejects unknown commands', async () => {
    const version = await run(['version'])
    expect(version.code).toBe(0)
    expect(JSON.parse(version.stdout)).toEqual({
      protocol: HELPER_PROTOCOL_VERSION,
      version: expect.any(String),
    })
    const selftest = await run(['selftest'])
    expect(selftest.code, selftest.stdout + selftest.stderr).toBe(0)
    expect(selftest.stdout).toMatch(/passed/)
    const unknown = await run(['frobnicate'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('unknown command')
  }, 60_000)

  it('creates its socket 0600 inside a fresh 0700 directory', async () => {
    const path = join(dir, 'run', 'helper.sock')
    const h = start(path)
    expect(await within(h.ready, 10_000, 'not ready')).toMatchObject({
      protocol: HELPER_PROTOCOL_VERSION,
    })
    expect(statSync(join(dir, 'run')).mode & 0o777).toBe(0o700)
    expect(statSync(path).isSocket()).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses to start a second helper on a live socket (exit 75)', async () => {
    const path = join(dir, 'h.sock')
    const first = start(path)
    const ready = await within(first.ready, 10_000, 'not ready')
    const second = start(path)
    const exit = await within(second.exited, 10_000, 'second helper kept running')
    expect(exit.code).toBe(EXIT_ALREADY_RUNNING)
    expect(exit.stderr).toContain('already listening')
    expect((await ping(path)).pid).toBe(ready?.pid)
  })

  it('shuts down cleanly on SIGTERM and removes its socket', async () => {
    const path = join(dir, 'h.sock')
    const h = start(path)
    await within(h.ready, 10_000, 'not ready')
    h.child.kill('SIGTERM')
    expect(await within(h.exited, 5000, 'still running after SIGTERM')).toMatchObject({ code: 0 })
    expect(existsSync(path)).toBe(false)
  })

  it('replaces the stale socket a killed helper leaves behind', async () => {
    const path = join(dir, 'h.sock')
    const crashed = start(path)
    await within(crashed.ready, 10_000, 'not ready')
    crashed.child.kill('SIGKILL')
    await crashed.exited
    expect(existsSync(path)).toBe(true) // stale: nobody listens
    const next = start(path)
    const ready = await within(next.ready, 10_000, 'restart failed')
    expect((await ping(path)).pid).toBe(ready?.pid)
  })

  it('exits when its parent process goes away', async () => {
    const parent = spawn('/bin/sleep', ['60'], { stdio: 'ignore' })
    children.push(parent)
    const h = start(join(dir, 'h.sock'), parent.pid ?? 0)
    await within(h.ready, 10_000, 'not ready')
    parent.kill('SIGKILL')
    expect(await within(h.exited, 5000, 'helper outlived its parent')).toMatchObject({ code: 0 })
  })

  it('exits at once when its parent is already gone', async () => {
    const gone = spawn('/usr/bin/true', [], { stdio: 'ignore' })
    await new Promise((r) => gone.once('exit', r))
    const h = start(join(dir, 'h.sock'), gone.pid ?? 0)
    expect(await within(h.exited, 5000, 'helper started without a parent')).toMatchObject({
      code: 0,
    })
    expect(await h.ready).toBeNull()
  })

  it('rejects a socket path longer than macOS allows', async () => {
    const h = start(join(dir, 'x'.repeat(120), 'helper.sock'))
    const exit = await within(h.exited, 5000, 'helper started on a too-long path')
    expect(exit.code).toBe(1)
    expect(exit.stderr).toContain('socket path is too long')
  })
})
