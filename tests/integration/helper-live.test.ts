/**
 * Live checks against this Mac's screen — only with DUMBLEDORE_LIVE=1 (unlocked screen, the
 * terminal running the tests granted Accessibility, Screen Recording for the OCR case, Google
 * Chrome installed). Reads the frontmost window, forces OCR on it, then opens the mock chat
 * (tools/mock-chat, port 5199) in a new Chrome window, finds its composer, writes a prompt into it
 * without sending, and closes the window again. Captured text is never printed.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SocketHelperClient, spawnLauncher } from '@engine/helper'
import { rectCenter } from '@shared/geometry'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MOCK_CHAT_PLACEHOLDER, MOCK_CHAT_TITLE } from '../../tools/mock-chat/page'
import { MOCK_CHAT_PORT, type MockChatServer, startMockChat } from '../../tools/mock-chat/server'

const HELPER = fileURLToPath(
  new URL('../../native/helper/build/dumbledore-helper', import.meta.url),
)
const LIVE = process.env.DUMBLEDORE_LIVE === '1' && existsSync(HELPER)
const CHROME = 'com.google.Chrome'

let dir: string
let helper: SocketHelperClient

async function until<T>(
  get: () => Promise<T> | T,
  ok: (v: T) => boolean,
  ms: number,
  what: string,
): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.skipIf(!LIVE)('helper on the live screen (DUMBLEDORE_LIVE=1)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dh-live-'))
    helper = new SocketHelperClient({
      launcher: spawnLauncher({ executable: HELPER }),
      socketPath: join(dir, 'helper.sock'),
    })
    await helper.start()
    expect(helper.status).toBe('connected')
    const { permissions } = await helper.call('ping', {})
    expect(permissions.accessibility, 'grant Accessibility to the app running the tests').toBe(true)
  }, 20_000)

  afterAll(async () => {
    await helper?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the frontmost window', async () => {
    const { windows } = await helper.call('perceive', { scope: 'frontmost' })
    expect(windows.length).toBeGreaterThan(0)
    const w = windows[0]
    expect(w?.changed).toBe(true)
    expect(w?.lines.length).toBeGreaterThan(0)
    expect(w?.contentHash).not.toBe('')
    const again = await helper.call('perceive', { scope: 'frontmost' })
    expect(again.windows[0]?.contentHash).toEqual(expect.any(String))
  }, 15_000)

  it('OCRs the frontmost window when forced', async () => {
    const { permissions } = await helper.call('ping', {})
    if (!permissions.screenRecording) return // Screen Recording not granted: nothing to check
    const { windows } = await helper.call('perceive', { scope: 'frontmost', forceOcr: true })
    const w = windows[0]
    expect(w?.source).toBe('ocr')
    expect(w?.lines.length).toBeGreaterThan(0)
    for (const line of w?.lines ?? []) expect(line.conf).toBeGreaterThan(0)
  }, 15_000)

  describe('mock chat in Chrome', () => {
    let chat: MockChatServer

    beforeAll(async () => {
      chat = await startMockChat({ port: MOCK_CHAT_PORT })
      await new Promise<void>((resolve, reject) =>
        execFile('open', ['-na', 'Google Chrome', '--args', '--new-window', chat.url], (e) =>
          e ? reject(e) : resolve(),
        ),
      )
      await until(
        () => chat.state(),
        (s) => s.pageConnected,
        15_000,
        'the mock chat page',
      )
    }, 30_000)

    afterAll(async () => {
      chat?.requestClose()
      await until(
        () => chat.state(),
        (s) => s.closed,
        3000,
        'the page to close',
      ).catch(() => {})
      await chat?.close()
    })

    it('finds the composer and writes a prompt into it without sending', async () => {
      const front = await until(
        () => helper.call('frontmost', {}),
        (f) => f?.bundleId === CHROME && (f.windowTitle ?? '').includes(MOCK_CHAT_TITLE),
        10_000,
        'Chrome with the mock chat in front',
      )
      const pid = front?.pid ?? null
      const found = await helper.call('ax.findChatInput', {
        pid,
        placeholders: [MOCK_CHAT_PLACEHOLDER],
      })
      expect(found.found).toBe(true)
      expect(found.frame?.width).toBeGreaterThan(200)

      const text = 'Explain the Calvin cycle in three steps. Älä käytä jargonia — kiitos!'
      const result = await helper.call('input.write', {
        text,
        mode: 'replaceAll',
        // An OCR-placeholder hit has no element ref: click into its frame instead.
        target:
          found.ref || !found.frame
            ? { ref: found.ref, point: null }
            : { ref: null, point: rectCenter(found.frame) },
        expectPid: pid,
      })
      expect(result.ok, result.reason ?? '').toBe(true)
      await until(
        () => chat.state(),
        (s) => s.input === text,
        5000,
        'the composer text',
      )
      expect(chat.state().sends).toBe(0)
    }, 30_000)
  })
})
