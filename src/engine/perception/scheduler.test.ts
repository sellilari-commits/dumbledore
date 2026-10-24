import { DEFAULT_SETTINGS, type Settings } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { cadenceFor } from './cadence'
import { CaptureScheduler, type PauseReason, type PerceiveBatch } from './scheduler'
import { flushAsync, runFor, ScriptedHelper, type ScriptedWindow } from './testing/scripted-helper'

const wiki: ScriptedWindow = {
  pid: 10,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 1,
  title: 'Osmosis - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Osmosis',
  lines: ['Osmosis is the movement of solvent molecules', 'through a semipermeable membrane'],
}
const pdf: ScriptedWindow = {
  pid: 20,
  bundleId: 'com.apple.Preview',
  appName: 'Preview',
  windowId: 5,
  title: 'lecture4.pdf',
  url: null,
  source: 'ocr',
  lines: ['Lecture 4: Entropy'],
}

describe('cadenceFor', () => {
  const base = { idleSeconds: 0, locked: false, lowPower: false, activeMs: 2000, idleMs: 10000 }
  it('follows the §6.4 policy', () => {
    expect(cadenceFor(base)).toEqual({ mode: 'active', intervalMs: 2000 })
    expect(cadenceFor({ ...base, idleSeconds: 59 }).mode).toBe('active')
    expect(cadenceFor({ ...base, idleSeconds: 60 })).toEqual({ mode: 'idle', intervalMs: 10000 })
    expect(cadenceFor({ ...base, idleSeconds: 300 }).mode).toBe('paused')
    expect(cadenceFor({ ...base, locked: true }).mode).toBe('paused')
    expect(cadenceFor({ ...base, lowPower: true }).intervalMs).toBe(4000)
    expect(cadenceFor({ ...base, idleSeconds: 90, lowPower: true }).intervalMs).toBe(20000)
  })
})

describe('CaptureScheduler', () => {
  let clock: FakeClock
  let helper: ScriptedHelper
  let settings: Settings
  let batches: PerceiveBatch[]
  let pauses: PauseReason[]
  let resumes: number
  let lowPower: boolean
  let scheduler: CaptureScheduler

  beforeEach(() => {
    clock = new FakeClock()
    helper = new ScriptedHelper(clock)
    helper.front = wiki
    settings = structuredClone(DEFAULT_SETTINGS)
    batches = []
    pauses = []
    resumes = 0
    lowPower = false
    scheduler = new CaptureScheduler({
      helper,
      clock,
      settings: () => settings,
      onBatch: (b) => batches.push(b),
      onPause: (r) => pauses.push(r),
      onResume: () => resumes++,
      isLowPower: () => lowPower,
    })
  })

  const perceiveScopes = () =>
    helper.callsOf('perceive').map((c) => (c.params as { scope: string }).scope)

  it('perceives the frontmost window every 2 s and visible windows every 3rd tick', async () => {
    helper.others = [pdf]
    scheduler.start()
    await runFor(clock, 6100)
    expect(batches).toHaveLength(4) // t = 0, 2, 4, 6 s
    expect(batches[0]?.front?.title).toBe('Osmosis - Wikipedia')
    expect(batches.map((b) => b.visible === null)).toEqual([true, true, false, true])
    expect(batches[2]?.visible?.map((w) => w.bundleId)).toEqual(['com.apple.Preview'])
    expect(perceiveScopes()).toEqual([
      'frontmost',
      'frontmost',
      'frontmost',
      'visible',
      'frontmost',
    ])
    const params = helper.callsOf('perceive')[0]?.params as {
      excludeBundleIds: string[]
      allowOcr: boolean
    }
    expect(params.allowOcr).toBe(true)
    expect(params.excludeBundleIds).toContain('com.apple.keychainaccess')
    expect(scheduler.isActive()).toBe(true)
  })

  it('slows down when idle, pauses after 5 min and resumes on input', async () => {
    scheduler.start()
    await runFor(clock, 100)
    helper.idleSeconds = 90
    await runFor(clock, 30_000)
    const idleTicks = batches.length
    expect(idleTicks).toBeLessThanOrEqual(5) // 0 s, 2 s, then every 10 s
    helper.idleSeconds = 400
    const before = helper.callsOf('perceive').length
    await runFor(clock, 30_000)
    expect(helper.callsOf('perceive').length).toBe(before)
    expect(pauses).toEqual(['idle'])
    expect(scheduler.isActive()).toBe(false)
    helper.idleSeconds = 1
    await runFor(clock, 6000)
    expect(resumes).toBe(1)
    expect(helper.callsOf('perceive').length).toBeGreaterThan(before)
  })

  it('doubles intervals in Low Power Mode', async () => {
    lowPower = true
    scheduler.start()
    await runFor(clock, 8100)
    expect(batches).toHaveLength(3) // 0, 4, 8 s
  })

  it('never reads a blocked app and learns its exact bundle id', async () => {
    helper.front = {
      ...wiki,
      pid: 30,
      bundleId: 'com.1password.1password8',
      appName: '1Password',
      windowId: 9,
      url: null,
      title: 'Vault',
    }
    helper.others = [pdf]
    scheduler.start()
    await runFor(clock, 6100)
    expect(perceiveScopes()).toEqual(['visible'])
    const params = helper.callsOf('perceive')[0]?.params as { excludeBundleIds: string[] }
    expect(params.excludeBundleIds).toContain('com.1password.1password8')
    expect(helper.served.some((w) => w.bundleId.startsWith('com.1password'))).toBe(false)
    expect(batches[0]?.frontBlocked).toEqual({ kind: 'app', category: 'password_manager' })
    expect(batches[0]?.front).toBeNull()
  })

  it('skips the frontmost read and the visible scan for blocked pages and private windows', async () => {
    helper.front = { ...wiki, url: 'https://www.op.fi/verkkopankki', title: 'OP' }
    helper.others = [pdf]
    scheduler.start()
    await runFor(clock, 6100)
    expect(helper.callsOf('perceive')).toHaveLength(0)
    expect(batches[0]?.frontBlocked?.kind).toBe('host')
    helper.front = { ...wiki, title: 'New Tab - Google Chrome (Incognito)', url: null }
    await runFor(clock, 6000)
    expect(helper.callsOf('perceive')).toHaveLength(0)
    expect(batches.at(-1)?.frontBlocked).toEqual({ kind: 'private_window' })
  })

  it('drops blocked windows from the visible scan', async () => {
    helper.others = [
      pdf,
      { ...wiki, windowId: 2, url: 'https://accounts.google.com/signin', title: 'Sign in' },
    ]
    scheduler.start()
    await runFor(clock, 4100)
    expect(batches[2]?.visible?.map((w) => w.bundleId)).toEqual(['com.apple.Preview'])
  })

  it('stops immediately when capture is switched off and resumes when switched on', async () => {
    scheduler.start()
    await runFor(clock, 2100)
    const before = helper.calls.length
    scheduler.setEnabled(false)
    await runFor(clock, 10_000)
    expect(helper.calls.length).toBe(before)
    expect(pauses).toEqual(['disabled'])
    expect(scheduler.mode).toBe('off')
    scheduler.setEnabled(true)
    await runFor(clock, 500)
    expect(helper.calls.length).toBeGreaterThan(before)
    settings = { ...settings, captureEnabled: false }
    scheduler.refresh()
    const after = helper.calls.length
    await runFor(clock, 10_000)
    expect(helper.calls.length).toBe(after)
  })

  it('pauses while the screen is locked', async () => {
    scheduler.start()
    await runFor(clock, 100)
    scheduler.setLocked(true)
    expect(pauses).toEqual(['locked'])
    const before = helper.callsOf('perceive').length
    await runFor(clock, 20_000)
    expect(helper.callsOf('perceive').length).toBe(before)
    scheduler.setLocked(false)
    await runFor(clock, 500)
    expect(helper.callsOf('perceive').length).toBe(before + 1)
  })

  it('survives helper errors and keeps ticking', async () => {
    helper.failNext.add('frontmost')
    scheduler.start()
    await runFor(clock, 100)
    expect(batches).toHaveLength(0)
    await runFor(clock, 6000)
    expect(batches.length).toBeGreaterThan(0)
  })

  it('ticks soon after a poke (app switch) and never overlaps ticks', async () => {
    scheduler.start()
    await runFor(clock, 100)
    expect(batches).toHaveLength(1)
    scheduler.poke()
    await runFor(clock, 400)
    expect(batches).toHaveLength(2)
    await scheduler.tickNow()
    await flushAsync()
    expect(batches).toHaveLength(3)
    scheduler.stop()
    await runFor(clock, 10_000)
    expect(batches).toHaveLength(3)
  })
})
