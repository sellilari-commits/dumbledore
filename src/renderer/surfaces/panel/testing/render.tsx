/**
 * Test helper for the panel window: providers, a memory router on `route`, and a fresh
 * zero-latency mock API (surface 'panel') whose database `prepare` can change before anything
 * is fetched. Every invoke is logged so tests can assert what reached main.
 */
import '@renderer/lib/test-utils' // jsdom polyfills + cleanup after each test
import { setApi } from '@renderer/lib/api'
import type { MockDb, MockScenario } from '@renderer/lib/mock/db'
import { createMockApi, type MockApi } from '@renderer/lib/mock-api'
import { createQueryClient, Providers } from '@renderer/lib/providers'
import type { InvokeChannel } from '@shared/ipc'
import { type RenderResult, render } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { PanelRoutes } from '../PanelApp'
import { forgetOpened } from '../TopicDetail'

// The mock opens other surfaces in a new tab; jsdom has no tabs.
if (typeof window !== 'undefined') window.open = (() => null) as typeof window.open

export interface PanelRender extends RenderResult {
  api: MockApi
  history: string[]
  /** Payloads of every invoke on `channel`, oldest first. */
  calls: (channel: InvokeChannel) => unknown[]
}

export function renderPanel({
  route = '/',
  scenario = 'demo',
  prepare,
}: {
  route?: string
  scenario?: MockScenario
  prepare?: (db: MockDb) => void
} = {}): PanelRender {
  forgetOpened() // what was opened in a topic detail lives while the panel does
  const api = createMockApi({ latencyMs: 0, scenario, surface: 'panel' })
  prepare?.(api.db)
  const log: Array<{ channel: InvokeChannel; payload: unknown }> = []
  const inner = api.invoke
  api.invoke = ((channel: InvokeChannel, ...args: unknown[]) => {
    log.push({ channel, payload: args[0] })
    return (inner as (c: InvokeChannel, ...a: unknown[]) => Promise<unknown>)(channel, ...args)
  }) as MockApi['invoke']
  setApi(api)
  const location = memoryLocation({ path: route, record: true })
  const result = render(
    <Providers client={createQueryClient({ retry: 0 })}>
      <Router hook={location.hook}>
        <PanelRoutes />
      </Router>
    </Providers>,
  )
  return {
    ...result,
    api,
    history: location.history,
    calls: (channel) => log.filter((c) => c.channel === channel).map((c) => c.payload),
  }
}
