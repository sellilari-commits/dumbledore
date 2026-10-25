import { HelperErrorCode, type PerceivedWindow } from '@shared/helper-protocol'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { HelperClientErrorCode, HelperRpcError } from './errors'
import { FakeHelper } from './fake'
import { defaultResult, type HelperFixture, parseFixture } from './fixtures'
import { HelperRecorder } from './recorder'

const app = { pid: 501, bundleId: 'com.google.Chrome', appName: 'Google Chrome' }

function chatWindow(text: string): PerceivedWindow {
  return {
    ...app,
    windowId: 9,
    title: 'ChatGPT',
    url: 'https://chatgpt.com/',
    frame: { x: 0, y: 0, width: 1200, height: 800 },
    source: 'ax',
    changed: true,
    contentHash: `ax:${text.length}`,
    lines: [{ text, conf: 1, box: null, align: 'left' }],
    capturedAt: '2026-10-24T09:00:00.000Z',
  }
}

describe('FakeHelper', () => {
  it('answers every method with a valid default', async () => {
    const helper = new FakeHelper()
    await helper.start()
    expect(helper.status).toBe('connected')
    expect(await helper.call('ping', {})).toEqual(defaultResult('ping'))
    expect(await helper.call('perceive', { scope: 'frontmost' })).toEqual({ windows: [] })
    expect(await helper.call('ax.findChatInput', { pid: null })).toMatchObject({ found: false })
  })

  it('applies protocol defaults to params and records calls', async () => {
    const helper = new FakeHelper({ connected: true })
    await helper.call('perceive', { scope: 'visible' })
    expect(helper.callsOf('perceive')[0]).toEqual({
      scope: 'visible',
      minChange: 6,
      allowOcr: true,
      forceOcr: false,
      maxChars: 20000,
      excludeBundleIds: [],
      fresh: false,
      wholePage: false,
    })
  })

  it('rejects invalid params and invalid scripted results', async () => {
    const helper = new FakeHelper({ connected: true })
    // @ts-expect-error wrong scope on purpose
    await expect(helper.call('perceive', { scope: 'everything' })).rejects.toMatchObject({
      code: HelperErrorCode.invalidParams,
    })
    // @ts-expect-error invalid result on purpose
    helper.respond('system.idle', { seconds: 'soon' })
    await expect(helper.call('system.idle', {})).rejects.toThrow(/invalid/)
  })

  it('resolves once → error → persistent → fixture → default', async () => {
    const helper = new FakeHelper({ connected: true })
    helper.respond('system.idle', { seconds: 5 })
    helper.respondOnce('system.idle', (_p, i) => ({ seconds: 100 + i }))
    expect(await helper.call('system.idle', {})).toEqual({ seconds: 100 })
    expect(await helper.call('system.idle', {})).toEqual({ seconds: 5 })
    helper.fail('input.write', HelperErrorCode.secureInput, 'password field', { once: true })
    const write = { text: 'hi', mode: 'insert' as const, target: null, expectPid: 501 }
    const error = await helper.call('input.write', write).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HelperRpcError)
    expect((error as HelperRpcError).isSecureInput).toBe(true)
    expect(await helper.call('input.write', write)).toMatchObject({ ok: true })
    expect(helper.writes()).toEqual(['hi', 'hi'])
  })

  it('fails calls while not connected', async () => {
    const helper = new FakeHelper()
    await expect(helper.call('ping', {})).rejects.toMatchObject({
      code: HelperClientErrorCode.notConnected,
    })
    const statuses: string[] = []
    helper.onStatus((s) => statuses.push(s))
    helper.setStatus('starting')
    helper.setStatus('connected')
    expect(statuses).toEqual(['starting', 'connected'])
  })

  it('validates and delivers emitted events', () => {
    const helper = new FakeHelper()
    const seen: string[] = []
    const off = helper.on('key.trigger', (p) => seen.push(p.gesture))
    helper.emit('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: false })
    const wiggle = {
      gesture: 'wiggle',
      key: 'rightOption',
      secureInput: false,
    } as unknown as Parameters<typeof helper.emit<'key.trigger'>>[1]
    expect(() => helper.emit('key.trigger', wiggle)).toThrow()
    off()
    helper.emit('key.trigger', { gesture: 'holdStart', key: 'rightOption', secureInput: false })
    expect(seen).toEqual(['tap'])
  })

  it('replays a fixture: results in order (last repeats) and timed events', async () => {
    const fixture: HelperFixture = {
      version: 1,
      responses: { perceive: [{ windows: [chatWindow('one')] }, { windows: [chatWindow('two')] }] },
      errors: { 'ax.selectedText': { code: HelperErrorCode.permissionDenied, message: 'no AX' } },
      events: [
        { atMs: 0, event: 'app.activated', payload: app },
        { atMs: 2000, event: 'screen.locked', payload: {} },
      ],
    }
    const clock = new FakeClock()
    const helper = new FakeHelper({ fixture, clock, connected: true })
    const texts = async () =>
      (await helper.call('perceive', { scope: 'frontmost' })).windows[0]?.lines[0]?.text
    expect(await texts()).toBe('one')
    expect(await texts()).toBe('two')
    expect(await texts()).toBe('two')
    await expect(helper.call('ax.selectedText', {})).rejects.toMatchObject({
      code: HelperErrorCode.permissionDenied,
    })
    const events: string[] = []
    helper.on('app.activated', (p) => events.push(`activated:${p.appName}`))
    helper.on('screen.locked', () => events.push('locked'))
    helper.replay(clock)
    clock.advance(0)
    expect(events).toEqual(['activated:Google Chrome'])
    clock.advance(2000)
    expect(events).toEqual(['activated:Google Chrome', 'locked'])
  })

  it('rejects fixtures with invalid results or events', () => {
    expect(() =>
      parseFixture({ version: 1, responses: { 'system.idle': [{ seconds: 'x' }] } }),
    ).toThrow(/responses.system.idle\[0\]/)
    expect(() =>
      parseFixture({ version: 1, events: [{ atMs: 0, event: 'app.activated', payload: {} }] }),
    ).toThrow(/events\[0\]/)
    expect(() => parseFixture({ version: 2 })).toThrow()
  })

  it('records a session that replays identically', async () => {
    const clock = new FakeClock()
    const live = new FakeHelper({ clock, connected: true })
    live.respondOnce('frontmost', {
      ...app,
      windowId: 1,
      windowTitle: 'x',
      windowFrame: null,
      isFullScreen: false,
      url: null,
    })
    const recorder = new HelperRecorder(live, clock)
    await recorder.call('frontmost', {})
    clock.advance(1500)
    live.emit('screen.unlocked', {})
    const fixture = parseFixture(JSON.parse(JSON.stringify(recorder.toFixture('test'))))
    expect(fixture.events).toEqual([{ atMs: 1500, event: 'screen.unlocked', payload: {} }])
    const replay = new FakeHelper({ fixture, connected: true })
    expect(await replay.call('frontmost', {})).toMatchObject({ windowTitle: 'x' })
  })
})
