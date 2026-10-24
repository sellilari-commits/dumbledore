/**
 * Ask bar entry (askbar.html). In Electron the card fills its small window; in a plain browser
 * (or with `?mock=1`) it floats on a fake desktop and talks to the Ask bar's own mock driver
 * (./mock/askMock: multi-turn chat, `?seed=<turns>`, `?theme=`, `#/choose`).
 */
import '@renderer/design-system/tokens.css'
import '../overlay/styles/ui.css'
import type { DumbledoreApi, EventChannel, InvokeChannel } from '@shared/ipc'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { wantsMock } from '../overlay/lib/bridge'
import { AskBar } from './AskBar'

/**
 * The mock loads lazily (it never ships in the real page's chunk), but the bar renders at once and
 * its calls wait for it, so the input is focused before the page finishes loading.
 */
function deferredApi(ready: Promise<DumbledoreApi>): DumbledoreApi {
  const invoke = (channel: InvokeChannel, ...args: unknown[]) =>
    ready.then((api) =>
      (api.invoke as (c: InvokeChannel, ...a: unknown[]) => unknown)(channel, ...args),
    )
  const on = (event: EventChannel, listener: (payload: unknown) => void) => {
    let off: (() => void) | null = null
    let live = true
    void ready.then((api) => {
      if (live)
        off = (api.on as (e: EventChannel, l: (p: unknown) => void) => () => void)(event, listener)
    })
    return () => {
      live = false
      off?.()
    }
  }
  return {
    surface: 'askbar',
    invoke: invoke as DumbledoreApi['invoke'],
    on: on as DumbledoreApi['on'],
  }
}

function boot(): void {
  const el = document.getElementById('root')
  if (!el) return
  if (!wantsMock() && window.dumbledore) {
    createRoot(el).render(
      <StrictMode>
        <AskBar api={window.dumbledore} />
      </StrictMode>,
    )
    return
  }
  const api = deferredApi(import('./mock/askMock').then((m) => m.createAskMock()))
  void import('../overlay/mock/mock.css')
  createRoot(el).render(
    <StrictMode>
      <div className="mk-desktop" aria-hidden />
      <div className="ask-stage">
        <AskBar api={api} />
      </div>
    </StrictMode>,
  )
}

boot()
