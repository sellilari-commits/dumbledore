/**
 * Picks the DumbledoreApi for this window: the preload's `window.dumbledore` inside Electron, or
 * the in-memory mock (demo data, simulated latency and events) only when asked for: ?mock=1, or a
 * dev-server page in a plain browser. A built app whose preload bridge is missing gets an API that
 * fails every call, so demo subjects can never show up (or be read back from the screen) as real.
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
import { cleanError } from './errors'
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

function inElectron(): boolean {
  return typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)
}

/**
 * Mock only on request: ?mock=1, or the Vite dev server opened in a plain browser (the UI
 * previews). Never in a production build or inside Electron without ?mock=1.
 */
export function isMock(): boolean {
  if (params().get('mock') === '1') return true
  const real = typeof window === 'undefined' ? undefined : window.dumbledore
  if (real) return false
  return import.meta.env.DEV && !inElectron()
}

/** Stand-in when the preload bridge is missing in the real app: every call fails loudly. */
export function unavailableApi(): DumbledoreApi {
  const error = () =>
    new Error(
      'Dumbledore could not connect to its engine (preload bridge missing). Restart the app.',
    )
  return {
    surface: surfaceFromPath(),
    invoke: (() => Promise.reject(error())) as DumbledoreApi['invoke'],
    on: () => () => {},
  } as DumbledoreApi
}

export function getApi(): DumbledoreApi {
  if (current) return current
  const real = typeof window === 'undefined' ? undefined : window.dumbledore
  if (real && !isMock()) current = real
  else if (!isMock()) {
    console.error('[dumbledore] preload bridge missing: not falling back to demo data')
    current = unavailableApi()
  } else {
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
  return getApi()
    .invoke(channel, ...args)
    .catch((err: unknown) => {
      throw cleanError(err)
    })
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
