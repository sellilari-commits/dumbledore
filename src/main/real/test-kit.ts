/**
 * Test kit for the real-engine integration tests: a temp data folder, a FakeClock that starts at
 * local noon (quiet hours never interfere, whatever the time zone), the helper lane's FakeHelper
 * driven by a scripted screen, FakeBrain, and composeReal wired to them. Nothing here reaches the
 * network, the real screen, the helper binary or the user's data folder.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '@engine/clock'
import { FakeHelper } from '@engine/helper'
import { type BrainOverrides, FakeBrain } from '@engine/testing/fake-brain'
import type { Rect } from '@shared/geometry'
import type { FrontmostInfo, PerceivedWindow, TextLine } from '@shared/helper-protocol'
import { composeReal, type RealComposeOptions, type RealComposition } from './compose-real'

export type ScreenLine = string | { text: string; align: 'left' | 'center' | 'right' }

export interface ScreenWindow {
  pid: number
  bundleId: string
  appName: string
  windowId: number
  title: string
  url: string | null
  lines: ScreenLine[]
  /** Where ax.findChatInput finds the chat box (AI chats only). */
  chatInput?: Rect
}

export const CHAT_INPUT: Rect = { x: 400, y: 820, width: 700, height: 56 }

/** A Wikipedia article read in Chrome. */
export const WIKI: ScreenWindow = {
  pid: 410,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 1,
  title: 'Photosynthesis - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Photosynthesis',
  lines: [
    'Photosynthesis is the process by which plants, algae and some bacteria turn light energy into chemical energy.',
    'It takes place in the chloroplasts, where chlorophyll absorbs mostly blue and red light.',
    'The light-dependent reactions split water, release oxygen and produce ATP and NADPH.',
    'The Calvin cycle then uses ATP and NADPH to fix carbon dioxide into three-carbon sugars.',
    'The enzyme RuBisCO catalyses the first step of carbon fixation in the Calvin cycle.',
    'Because RuBisCO also reacts with oxygen, hot and dry conditions lead to photorespiration.',
    'C4 and CAM plants separate carbon fixation in space or in time to limit photorespiration.',
    'The overall equation is 6 CO2 + 6 H2O + light → C6H12O6 + 6 O2.',
    'Photosystem II absorbs light at 680 nm and photosystem I at 700 nm.',
    'Electrons pass along the electron transport chain and pump protons into the thylakoid space.',
    'The proton gradient drives ATP synthase, a process called photophosphorylation.',
    'Photosynthesis supplies most of the energy and nearly all the oxygen in Earth’s ecosystems.',
  ],
}

/** ChatGPT in Chrome: detected by its URL; the chat box is findable. */
export const CHATGPT: ScreenWindow = {
  pid: 501,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 7,
  title: 'ChatGPT',
  url: 'https://chatgpt.com/c/study',
  lines: ['ChatGPT', 'Ask anything'],
  chatInput: CHAT_INPUT,
}

/** Something that is not learning, to switch to. */
export const NOTES: ScreenWindow = {
  pid: 777,
  bundleId: 'com.apple.Notes',
  appName: 'Notes',
  windowId: 3,
  title: 'Groceries',
  url: null,
  lines: ['milk', 'eggs'],
}

const toLine = (l: ScreenLine): TextLine =>
  typeof l === 'string'
    ? { text: l, conf: 1, box: null, align: 'left' }
    : { text: l.text, conf: 1, box: null, align: l.align }

function hashOf(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/** The screen behind a FakeHelper: frontmost, perceive (with change detection), chat input, idle. */
export class FakeScreen {
  front: ScreenWindow | null = null
  others: ScreenWindow[] = []
  idleSeconds = 0
  private readonly lastHash = new Map<string, string>()

  constructor(
    private readonly helper: FakeHelper,
    private readonly clock: FakeClock,
  ) {
    helper.respond('frontmost', () => (this.front ? frontmostOf(this.front) : null))
    helper.respond('system.idle', () => ({ seconds: this.idleSeconds }))
    helper.respond('perceive', (p) => ({ windows: this.perceive(p.scope, p.excludeBundleIds) }))
    helper.respond('ax.findChatInput', (p) => {
      const win = [this.front, ...this.others].find((w) => w?.pid === p.pid && w.chatInput)
      return win?.chatInput
        ? { found: true, frame: win.chatInput, ref: `ax-${win.pid}-chat`, method: 'ax_search' }
        : { found: false, frame: null, ref: null, method: null }
    })
  }

  /** Brings `win` to the front (as an app switch the helper reports). */
  show(win: ScreenWindow | null): void {
    this.front = win
    if (win && this.helper.status === 'connected') {
      this.helper.emit('app.activated', {
        pid: win.pid,
        bundleId: win.bundleId,
        appName: win.appName,
      })
    }
  }

  /** Replaces the front window's text (e.g. the AI answered). */
  setLines(lines: ScreenLine[]): void {
    if (this.front) this.front = { ...this.front, lines }
  }

  private perceive(scope: 'frontmost' | 'visible', exclude: string[]): PerceivedWindow[] {
    const pool = scope === 'frontmost' ? [this.front] : [this.front, ...this.others]
    return pool
      .filter((w): w is ScreenWindow => w !== null && !exclude.includes(w.bundleId))
      .map((w) => this.perceived(w))
  }

  private perceived(w: ScreenWindow): PerceivedWindow {
    const lines = w.lines.map(toLine)
    const key = `${w.bundleId}#${w.windowId}`
    const hash = hashOf(
      `${w.title}|${w.url}|${lines.map((l) => `${l.align}:${l.text}`).join('\n')}`,
    )
    const changed = this.lastHash.get(key) !== hash
    this.lastHash.set(key, hash)
    return {
      pid: w.pid,
      bundleId: w.bundleId,
      appName: w.appName,
      windowId: w.windowId,
      title: w.title,
      url: w.url,
      frame: null,
      source: 'ax',
      changed,
      contentHash: hash,
      lines: changed ? lines : [],
      capturedAt: this.clock.nowIso(),
    }
  }
}

function frontmostOf(w: ScreenWindow): FrontmostInfo {
  return {
    pid: w.pid,
    bundleId: w.bundleId,
    appName: w.appName,
    windowId: w.windowId,
    windowTitle: w.title,
    windowFrame: null,
    isFullScreen: false,
    url: w.url,
  }
}

/** Local noon on a day of October 2026, as epoch ms. */
export function localNoon(day = 26): number {
  return new Date(2026, 9, day, 12, 0, 0, 0).getTime()
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Lets pending promise chains (helper replies, LLM fakes, background saves) run. */
export async function flushAsync(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** Advances the FakeClock in small steps, letting async work finish between steps. */
export async function runFor(clock: FakeClock, ms: number, stepMs = 250): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    clock.advance(Math.min(stepMs, ms - t))
    await flushAsync()
  }
}

export interface Rig {
  dir: string
  clock: FakeClock
  helper: FakeHelper
  screen: FakeScreen
  brain: FakeBrain
  comp: RealComposition
  services: RealComposition['services']
}

export interface RigOptions {
  dir?: string
  clock?: FakeClock
  brain?: FakeBrain | BrainOverrides
  compose?: Partial<RealComposeOptions>
}

export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'dumbledore-real-'))
}

/**
 * composeReal on a temp data folder with a FakeHelper + FakeScreen, FakeBrain and no access to
 * the environment (no data-dir override, no keys, no helper mode from the developer's shell).
 */
export function createRig(opts: RigOptions = {}): Rig {
  const dir = opts.dir ?? tempDataDir()
  const clock = opts.clock ?? new FakeClock(localNoon())
  const helper = new FakeHelper({ clock })
  const screen = new FakeScreen(helper, clock)
  const brain = opts.brain instanceof FakeBrain ? opts.brain : new FakeBrain(opts.brain)
  const comp = composeReal({
    clock,
    dataDir: dir,
    env: {},
    helper,
    brain,
    keys: () => undefined,
    log: () => {},
    ...opts.compose,
  })
  return { dir, clock, helper, screen, brain, comp, services: comp.services }
}

/** Closes the composition and deletes its data folder. */
export async function disposeRig(rig: Rig): Promise<void> {
  await rig.comp.close()
  rmSync(rig.dir, { recursive: true, force: true })
}
