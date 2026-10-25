import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHandlers } from '../ipc/handlers'
import { createHarness, fakeExtras, flush } from '../testing/harness'
import { createTestControlApi } from './api'
import { type TestControlInfo, TestControlServer } from './server'

function http(
  info: TestControlInfo,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${info.token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          }),
        )
      },
    )
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('TestControlServer', () => {
  const dirs: string[] = []
  const servers: TestControlServer[] = []
  afterEach(async () => {
    for (const s of servers.splice(0)) await s.stop()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  async function start() {
    const h = await createHarness()
    const handlers = createHandlers(h.core, fakeExtras(join(tmpdir(), 'dd-tc-unused')).extras)
    const keys: string[] = []
    const api = createTestControlApi({
      core: h.core,
      handlers,
      fakes: { helper: h.helper, perception: h.perception },
      windows: () => ({ panel: h.surfaces.isOpen('panel') }),
      forwardKey: (key) => void keys.push(key),
    })
    const dir = mkdtempSync(join(tmpdir(), 'dd-tc-'))
    dirs.push(dir)
    const file = join(dir, 'test-control.json')
    const server = new TestControlServer(api, file)
    servers.push(server)
    const info = await server.start()
    return { h, info, file, keys }
  }

  it('writes port and token to an owner-only file', async () => {
    const { info, file } = await start()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(info)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(info.token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('refuses requests without the token or with a foreign Host header', async () => {
    const { info } = await start()
    expect(
      (await http(info, 'GET', '/health', undefined, { Authorization: 'Bearer nope' })).status,
    ).toBe(401)
    expect(
      (await http(info, 'GET', '/health', undefined, { Host: 'evil.example:80' })).status,
    ).toBe(401)
    expect((await http(info, 'GET', '/health')).json).toMatchObject({ ok: true })
  })

  it('reads overlay, session and app state', async () => {
    const { info } = await start()
    expect(
      ((await http(info, 'GET', '/state/overlay')).json as { displayId: number }).displayId,
    ).toBe(1)
    expect((await http(info, 'GET', '/state/session')).json).toBeNull()
    expect((await http(info, 'GET', '/state/app')).json).toMatchObject({ helper: 'connected' })
    expect((await http(info, 'GET', '/state/windows')).json).toEqual({ panel: false })
  })

  it('drives the fake helper and perception, then routes a gesture', async () => {
    const { info, h } = await start()
    const chatgpt = {
      pid: 501,
      bundleId: 'com.google.Chrome',
      appName: 'Google Chrome',
      windowId: null,
      windowTitle: 'ChatGPT',
      windowFrame: null,
      isFullScreen: false,
      url: 'https://chatgpt.com/',
    }
    const focused = {
      pid: 501,
      bundleId: 'com.google.Chrome',
      appName: 'Google Chrome',
      role: 'AXTextArea',
      subrole: null,
      editable: true,
      isSecure: false,
      frame: { x: 400, y: 820, width: 700, height: 56 },
      caret: null,
      placeholder: 'Ask anything',
      valueLength: 0,
      ref: 'ax-1',
    }
    const set = await http(info, 'POST', '/fake/helper/state', {
      frontmost: chatgpt,
      emitActivated: true,
      writeResult: { ok: true, method: 'paste', verified: true, reason: null },
    })
    expect(set.status).toBe(200)
    await flush()
    expect(h.perception.aiChat()?.assistant).toBe('ChatGPT')
    await http(info, 'POST', '/fake/helper/state', { focused, fieldValue: '', emitFocus: true })
    const overlay = (await http(info, 'GET', '/state/overlay')).json as { orb: { docked: boolean } }
    // The orb stays on the right edge; it no longer docks beside chat boxes by default.
    expect(overlay.orb.docked).toBe(false)
    const tap = await http(info, 'POST', '/gesture', { gesture: 'tap' })
    // An empty chat box with no session gets the best next prompt (a tap never starts a roadmap).
    expect(tap.json).toEqual({ decision: { kind: 'suggest' } })
    expect(h.helper.state.fieldValue).toMatch(/No greetings/)
  })

  it('invokes IPC channels with validation and reports bad bodies', async () => {
    const { info } = await start()
    const res = await http(info, 'POST', '/invoke', { channel: 'settings.get' })
    expect((res.json as { result: { theme: string } }).result.theme).toBe('system')
    expect((await http(info, 'POST', '/invoke', { channel: 'nope' })).status).toBe(400)
    expect(
      (await http(info, 'POST', '/invoke', { channel: 'subjects.get', payload: '' })).status,
    ).toBe(400)
    expect((await http(info, 'POST', '/gesture', { gesture: 'wiggle' })).status).toBe(400)
    expect((await http(info, 'GET', '/nowhere')).status).toBe(404)
  })

  it('forwards overlay actions and key events', async () => {
    const { info, h } = await start()
    await http(info, 'POST', '/overlay/action', { action: { type: 'orbLongPress' }, displayId: 1 })
    await flush()
    expect(h.surfaces.log).toContain('open:askbar')
    await http(info, 'POST', '/fake/helper/event', {
      event: 'key.trigger',
      payload: { gesture: 'tap', key: 'rightOption', secureInput: false },
    })
    // Key taps wait out the double-tap window (doubleTapMs + 150 ms) before they act.
    await new Promise((resolve) => setTimeout(resolve, 600))
    await flush()
    expect(h.surfaces.enters).toEqual(['askbar'])
  })

  it('forwards quiz-card keys and rejects others', async () => {
    const { info, keys } = await start()
    expect((await http(info, 'POST', '/key', { key: '3' })).json).toEqual({ ok: true })
    expect((await http(info, 'POST', '/key', { key: 'Escape' })).status).toBe(200)
    expect((await http(info, 'POST', '/key', { key: 'q' })).status).toBe(400)
    expect(keys).toEqual(['3', 'Escape'])
  })

  it('removes its file when stopped', async () => {
    const { file } = await start()
    const server = servers.pop()
    await server?.stop()
    expect(() => statSync(file)).toThrow()
  })
})
