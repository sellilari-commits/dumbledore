/**
 * Test helpers for renderer components (Vitest + Testing Library, jsdom): polyfills for what
 * Radix/cmdk need, automatic cleanup, and `renderWithApp` — providers, an in-memory router
 * and a fresh mock API (zero latency) per test.
 */
import { cleanup, type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { setApi } from './api'
import type { MockScenario } from './mock/db'
import { createMockApi, type MockApi, type MockOptions } from './mock-api'
import { createQueryClient, Providers } from './providers'

afterEach(() => {
  cleanup()
  setApi(null)
})

// ─── jsdom gaps ───────────────────────────────────────────────────────────────────────────
const g = globalThis as unknown as Record<string, unknown>
if (!g.ResizeObserver) {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.scrollIntoView ??= () => {}
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

export interface AppRender extends RenderResult {
  api: MockApi
  navigate: (to: string) => void
  history: string[]
}

export function renderWithApp(
  ui: ReactElement,
  {
    route = '/home',
    scenario = 'demo',
    surface = 'app',
    mock = {},
  }: {
    route?: string
    scenario?: MockScenario
    surface?: MockApi['surface']
    /** More mock options, e.g. { geminiEnvKey: false }. */
    mock?: Omit<MockOptions, 'scenario' | 'surface'>
  } = {},
): AppRender {
  const api = createMockApi({ latencyMs: 0, ...mock, scenario, surface })
  setApi(api)
  const client = createQueryClient({ retry: 0 })
  const location = memoryLocation({ path: route, record: true })
  const result = render(
    <Providers client={client}>
      <Router hook={location.hook}>{ui}</Router>
    </Providers>,
  )
  return { ...result, api, navigate: location.navigate, history: location.history }
}
