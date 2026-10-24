/**
 * Picks the DumbledoreApi for this window: the preload's `window.dumbledore` inside Electron, or
 * the in-memory mock (demo data, simulated latency and events) in a plain browser or with ?mock=1.
 * Everything else in the renderer goes through `invoke`/`on` from here, never the global directly.
 */
import type {
  DumbledoreApi,
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeRes,
} from '@shared/ipc'
import { createMockApi, type MockApi, type MockOptions } from './mock-api'

let current: DumbledoreApi | null = null

function params(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function surfaceFromPath(): DumbledoreApi['surface'] {
  const page =
    typeof window === 'undefined' ? '' : (window.location.pathname.split('/').pop() ?? '')
  if (page.startsWith('panel')) return 'panel'
  if (page.startsWith('overlay')) return 'overlay'
  if (page.startsWith('askbar')) return 'askbar'
  return 'app'
}

/**
 * Mock options from the URL: ?mock=1&scenario=empty|error|slow|onboarding&latency=ms, and
 * &geminiEnv=0 for a machine without the dev Gemini key (shows "add a key").
 */
export function mockOptionsFromUrl(): MockOptions {
  const p = params()
  const scenario = p.get('scenario')
  const latency = p.get('latency')
  return {
    geminiEnvKey: p.get('geminiEnv') !== '0',
    surface: surfaceFromPath(),
    scenario:
      scenario === 'empty' ||
      scenario === 'error' ||
      scenario === 'slow' ||
      scenario === 'onboarding'
        ? scenario
        : 'demo',
    latencyMs: latency === null ? undefined : Number(latency),
  }
}

export function isMock(): boolean {
  const real = typeof window === 'undefined' ? undefined : window.dumbledore
  return !real || params().get('mock') === '1'
}

export function getApi(): DumbledoreApi {
  if (current) return current
  const real = typeof window === 'undefined' ? undefined : window.dumbledore
  if (real && !isMock()) current = real
  else {
    const mock = createMockApi(mockOptionsFromUrl())
    // For the browser console and screenshot scripts: __dumbledoreMock.pressKey(), .db, .emit().
    ;(globalThis as { __dumbledoreMock?: MockApi }).__dumbledoreMock = mock
    current = mock
  }
  return current
}

/** Tests swap in their own API (or reset with null). */
export function setApi(next: DumbledoreApi | null): void {
  current = next
}

export function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeRes<C>> {
  return getApi().invoke(channel, ...args)
}

export function on<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  return getApi().on(event, listener)
}

export function surface(): DumbledoreApi['surface'] {
  return getApi().surface
}
