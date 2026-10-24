/**
 * Browser-only stage for the mock driver: a fake desktop with a ChatGPT-like window behind the
 * transparent overlay (so states can be judged in context), and a small scene picker
 * (hidden with `?clean=1`, which screenshots use).
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { ReactNode } from 'react'
import { useOverlayState } from '../lib/useOverlayState'
import { useViewport } from '../lib/useViewport'
import { browserRect, chatBoxRect, SCENES } from './scenes'
import './mock.css'

export function MockStage({ api, children }: { api: DumbledoreApi; children: ReactNode }) {
  const state = useOverlayState(api)
  const vp = useViewport()
  const win = browserRect(vp)
  const box = chatBoxRect(vp)
  const clean = new URLSearchParams(window.location.search).get('clean') === '1'
  const focused = state?.dockTarget != null
  const typed = state?.chip?.kind === 'improve' ? state.chip.text : ''

  return (
    <>
      <div className="mk-desktop" aria-hidden>
        <div
          className="mk-window"
          style={{ left: win.x, top: win.y, width: win.width, height: win.height }}
        >
          <div className="mk-titlebar">
            <span className="mk-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="mk-url">chatgpt.com</span>
          </div>
          <div className="mk-thread" style={{ width: box.width }}>
            <div className="mk-bubble mk-bubble--me">
              Why is a tertiary carbocation more stable?
            </div>
            <div className="mk-lines">
              <i style={{ width: '92%' }} />
              <i style={{ width: '84%' }} />
              <i style={{ width: '88%' }} />
              <i style={{ width: '46%' }} />
            </div>
            <div className="mk-lines">
              <i style={{ width: '90%' }} />
              <i style={{ width: '72%' }} />
            </div>
          </div>
        </div>
        <div
          className="mk-chatbox"
          data-focused={focused || undefined}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        >
          {typed ? (
            <span className="mk-typed">
              {typed}
              <span className="mk-caret" />
            </span>
          ) : (
            <span className="mk-placeholder">
              {focused && <span className="mk-caret" />}Ask anything
            </span>
          )}
        </div>
      </div>
      {children}
      {!clean && (
        <nav className="mk-controls">
          {SCENES.map((name) => (
            <button key={name} type="button" onClick={() => window.__ddMock?.scene(name)}>
              {name}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}
