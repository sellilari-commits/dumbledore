/**
 * Test harness for the shell: the full shell core on fakes (memory repos, FakeBrain, fake
 * helper, fake perception) with a FakeClock, a fake platform and fake window surfaces, plus a
 * ChatGPT-in-Chrome scenario. Used by the unit tests only.
 */
import type { Brain } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Rect } from '@shared/geometry'
import type { FocusedElement, FrontmostInfo } from '@shared/helper-protocol'
import type { EventPayload } from '@shared/ipc'
import type { OverlayState } from '@shared/state'
import { compose } from '../compose'
import { FakeHelperClient, makeFocused, makeFrontmost } from '../fakes/fake-helper'
import type { FakePerceptionService } from '../fakes/fake-perception'
import type { HandlerExtras } from '../ipc/handlers'
import type { DisplayInfo } from '../overlay/geometry'
import type { OpenOptions, ShellPlatform, SurfaceControl, WindowSurface } from '../platform'
import { createShellCore, type ShellCore } from '../shell'

export const OWN_PID = 999

export const DISPLAY: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 33, width: 1512, height: 949 },
  primary: true,
}

export const SECOND_DISPLAY: DisplayInfo = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1512, y: 25, width: 1920, height: 1055 },
  primary: false,
}

export const CHAT_FRAME: Rect = { x: 400, y: 820, width: 700, height: 56 }

export const CHATGPT: FrontmostInfo = makeFrontmost(
  { pid: 501, bundleId: 'com.google.Chrome', appName: 'Google Chrome' },
  { url: 'https://chatgpt.com/c/123', windowTitle: 'ChatGPT', windowFrame: DISPLAY.workArea },
)

export const NOTES: FrontmostInfo = makeFrontmost(
  { pid: 777, bundleId: 'com.apple.Notes', appName: 'Notes' },
  { windowTitle: 'Notes' },
)

export function chatInput(value = ''): FocusedElement {
  return makeFocused(CHATGPT, {
    frame: CHAT_FRAME,
    valueLength: value.length,
    ref: 'ax-chatgpt-input',
    placeholder: 'Ask anything',
  })
}

export class FakePlatform implements ShellPlatform {
  readonly ownPid = OWN_PID
  active = false
  hides = 0
  restores = 0
  clipboard: string | null = null

  constructor(private readonly onHide: () => void = () => undefined) {}

  isAppActive(): boolean {
    return this.active
  }

  hideApp(): void {
    this.hides++
    this.active = false
    this.onHide()
  }

  restoreOverlays(): void {
    this.restores++
  }

  writeClipboard(text: string): void {
    this.clipboard = text
  }

  async sleep(): Promise<void> {}
}

export class FakeSurfaces implements SurfaceControl {
  readonly opened = new Set<WindowSurface>()
  readonly log: string[] = []
  readonly enters: string[] = []
  lastOptions: OpenOptions | null = null
  private askbarRouteOpened: string | null = null

  isOpen(surface: WindowSurface): boolean {
    return this.opened.has(surface)
  }

  askbarRoute(): 'chat' | 'prompt' | null {
    if (!this.opened.has('askbar')) return null
    return this.askbarRouteOpened === 'prompt' ? 'prompt' : 'chat'
  }

  async open(surface: WindowSurface, opts: OpenOptions = {}): Promise<void> {
    this.opened.add(surface)
    this.lastOptions = opts
    if (surface === 'askbar') this.askbarRouteOpened = opts.route ?? null
    this.log.push(`open:${surface}${opts.route ? `:${opts.route}` : ''}`)
  }

  async close(surface: WindowSurface): Promise<void> {
    this.opened.delete(surface)
    this.log.push(`close:${surface}`)
  }

  pressEnter(surface: 'askbar' | 'overlay'): void {
    this.enters.push(surface)
  }
}

/** Handler extras that record what they were asked to do; exports go to `exportDir`. */
export function fakeExtras(exportDir: string): { extras: HandlerExtras; calls: string[] } {
  const calls: string[] = []
  const extras: HandlerExtras = {
    openSystemSettings: async (kind) => void calls.push(`settings:${kind}`),
    setOverlayInteractive: (id, on) => void calls.push(`interactive:${id}:${on}`),
    showOrbMenu: () => void calls.push('menu'),
    setWindowSize: (s, w, h) => void calls.push(`size:${s}:${w}x${h}`),
    exportDir,
    revealFile: (path) => void calls.push(`reveal:${path}`),
    deleteAllData: async () => void calls.push('deleteAll'),
    relaunch: () => void calls.push('relaunch'),
    openExternal: async (url) => void calls.push(`open:${url}`),
    pickMaterialFiles: async () => {
      calls.push('pickMaterial')
      return []
    },
  }
  return { extras, calls }
}

export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve))
}

export interface Harness {
  clock: FakeClock
  helper: FakeHelperClient
  perception: FakePerceptionService
  platform: FakePlatform
  surfaces: FakeSurfaces
  core: ShellCore
  services: ShellCore['services']
  overlayStates: OverlayState[]
  deltas: EventPayload<'chat.delta'>[]
  appStateChanges: number
}

export async function createHarness(
  opts: { seed?: boolean; brain?: Brain } = {},
): Promise<Harness> {
  const clock = new FakeClock()
  const helper = new FakeHelperClient()
  const { services, fakes } = compose({
    clock,
    helper,
    brain: opts.brain,
    seed: opts.seed ?? true,
    ownPid: OWN_PID,
  })
  const perception = fakes.perception
  if (!perception) throw new Error('compose() must use the fake perception in tests')
  const surfaces = new FakeSurfaces()
  // Hiding Dumbledore lets macOS activate the previous app; the fake helper mirrors that.
  const platform = new FakePlatform()
  const h: Harness = {
    clock,
    helper,
    perception,
    platform,
    surfaces,
    services,
    core: null as unknown as ShellCore,
    overlayStates: [],
    deltas: [],
    appStateChanges: 0,
  }
  h.core = createShellCore(services, {
    platform,
    surfaces,
    version: '0.0.0-test',
    onOverlayChange: (state) => h.overlayStates.push(state),
    onChatDelta: (delta) => h.deltas.push(delta),
    onBusy: () => undefined,
    onAppStateChange: () => {
      h.appStateChanges++
    },
  })
  h.core.overlay.setDisplays([DISPLAY])
  h.core.start()
  await services.start()
  await flush()
  return h
}

/** ChatGPT in Chrome is frontmost (AI chat detected) and its input is focused with `value`. */
export async function inChatGPT(h: Harness, value = ''): Promise<void> {
  h.helper.state.writeResult = { ok: true, method: 'paste', verified: true, reason: null }
  h.helper.activateApp(CHATGPT)
  await flush()
  h.helper.focus(chatInput(value), value)
  await flush()
}
