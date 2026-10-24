/**
 * Mock driver for browser development (no Electron, or `?mock=1`). Serves a scripted
 * OverlayState — a pinned `?scene=<name>` or a tour through every state — reacts to the overlay's
 * actions like a small fake main process, and answers quiz and Ask bar calls from fixtures.
 * `?theme=dark|light` forces a theme. `window.__ddMock` exposes the state and an action log.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { OverlayAction, OverlayState } from '@shared/state'
import type { SurfaceName } from '../lib/bridge'
import type { Size } from '../lib/layout'
import { createLocalApi } from '../lib/localApi'
import { ASK_RESULT, answerOf, demoQuiz, resultOf } from './fixtures'
import { DEMO_QUIZ_ID, isScene, type SceneName, sceneState, TIP, TOUR } from './scenes'

export const ASK_THREAD = 'ask'
const TOUR_STEP_MS = 3200

export interface MockHandle {
  state: () => OverlayState
  scene: (name: SceneName) => void
  actions: OverlayAction[]
  calls: Array<{ channel: string; payload: unknown }>
}

declare global {
  interface Window {
    __ddMock?: MockHandle
  }
}

export function createMockApi(surface: SurfaceName): DumbledoreApi {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
  return surface === 'askbar' ? createAskbarMock() : createOverlayMock(params)
}

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

function createOverlayMock(params: URLSearchParams): DumbledoreApi {
  const pinned = params.get('scene')
  let state = sceneState(isScene(pinned) ? pinned : 'idle', viewport())
  const answers = new Map<string, number>()
  const actions: OverlayAction[] = []
  const timers = new Set<number>()

  const local = createLocalApi('overlay', {
    'overlay.getState': () => state,
    'overlay.action': (action) => {
      actions.push(action)
      react(action)
    },
    'quiz.get': (id) => demoQuiz(id, answers),
    'quiz.answer': ({ questionId, chosenIndex }) => {
      answers.set(questionId, chosenIndex)
      return answerOf(questionId, chosenIndex)
    },
    'quiz.finish': (id) => resultOf(id, answers),
    'prompt.sendToChat': () => ({ ok: true, reason: null }),
  })

  const set = (next: OverlayState) => {
    state = next
    local.emit('overlay.changed', state)
  }
  const later = (ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }
  const think = (then: (s: OverlayState) => OverlayState, ms = 1200) => {
    set({ ...state, orb: { ...state.orb, thinking: true } })
    later(ms, () => set(then({ ...state, orb: { ...state.orb, thinking: false } })))
  }
  const stopTour = () => {
    for (const t of timers) window.clearTimeout(t)
    timers.clear()
  }

  // A small fake main: enough behaviour to click through every surface in the browser.
  const react = (action: OverlayAction) => {
    if (action.type === 'hover') return
    if (!isScene(pinned)) stopTour()
    const vp = viewport()
    switch (action.type) {
      case 'orbDrag': {
        if (!action.done) return
        const edge = action.x > vp.width / 2 ? 'right' : 'left'
        const y = Math.min(Math.max(action.y, 48), vp.height - 48)
        const x = edge === 'right' ? vp.width - 32 : 32
        set({
          ...state,
          edge,
          dockTarget: null,
          chip: null,
          orb: { ...state.orb, x, y, size: 40, docked: false },
        })
        return
      }
      case 'orbClick':
        if (state.orb.dot !== 'none') set({ ...state, orb: { ...state.orb, dot: 'none' } })
        else if (state.side.quiz) set({ ...state, quiz: { quizId: DEMO_QUIZ_ID } })
        else if (state.side.next) react({ type: 'sideNext' })
        return
      case 'sideNext':
        think((s) => {
          const p = s.orb.progress ?? { k: 0, n: 8 }
          const k = Math.min(p.n, p.k + 1)
          return {
            ...s,
            orb: { ...s.orb, progress: { k, n: p.n } },
            side:
              k % 4 === 0
                ? { next: null, quiz: true }
                : { next: { label: `${k}/${p.n}` }, quiz: false },
            toasts: [TIP],
          }
        })
        return
      case 'sideQuiz':
        set({ ...state, quiz: { quizId: DEMO_QUIZ_ID } })
        return
      case 'timerClick':
        set({ ...state, timer: null })
        return
      case 'timerStart':
        set({
          ...state,
          timerMinutes: action.minutes,
          timer: { endsAt: new Date(Date.now() + action.minutes * 60_000).toISOString() },
        })
        return
      case 'quizClose': {
        const p = state.orb.progress
        set({
          ...state,
          quiz: null,
          side: p ? { next: { label: `${p.k}/${p.n}` }, quiz: false } : state.side,
        })
        return
      }
      case 'pillClick':
        think(() => sceneState('session', vp), 1400)
        return
      case 'chipClick':
        set({ ...state, chip: null, toasts: [TIP] })
        return
      case 'toastAction':
        set({
          ...state,
          toasts: state.toasts.filter((t) => t.id !== action.toastId),
          quiz: action.actionId === 'start' ? { quizId: DEMO_QUIZ_ID } : state.quiz,
        })
        return
      case 'toastDismiss': {
        const toast = state.toasts.find((t) => t.id === action.toastId)
        const dot = toast?.kind === 'nudge' ? 'orange' : state.orb.dot
        set({
          ...state,
          toasts: state.toasts.filter((t) => t.id !== action.toastId),
          orb: { ...state.orb, dot },
        })
        return
      }
      default:
        return // orbLongPress, orbContextMenu: main would open the Ask bar / menu.
    }
  }

  if (!isScene(pinned)) {
    let i = 0
    const step = () => {
      i = (i + 1) % TOUR.length
      const name = TOUR[i] ?? 'idle'
      set(sceneState(name, viewport()))
      later(TOUR_STEP_MS, step)
    }
    later(TOUR_STEP_MS, step)
  }

  window.__ddMock = {
    state: () => state,
    scene: (name) => {
      stopTour()
      answers.clear()
      set(sceneState(name, viewport()))
    },
    actions,
    calls: local.calls,
  }
  return local.api
}

function createAskbarMock(): DumbledoreApi {
  const local = createLocalApi('askbar', {
    'ask.submit': async ({ text }) => {
      const messageId = `msg_${Date.now()}`
      const words = ASK_RESULT.reply.split(/(?<= )/)
      for (let i = 0; i < words.length; i += 3) {
        await new Promise((r) => window.setTimeout(r, 35))
        const delta = words.slice(i, i + 3).join('')
        local.emit('chat.delta', { thread: ASK_THREAD, messageId, delta, done: false })
      }
      local.emit('chat.delta', { thread: ASK_THREAD, messageId, delta: '', done: true })
      return text.trim().toLowerCase() === 'paste' ? { ...ASK_RESULT, pasted: true } : ASK_RESULT
    },
    'coach.runAction': () => undefined,
    'window.close': () => undefined,
    'window.setSize': () => undefined,
  })
  window.__ddMock = {
    state: () => {
      throw new Error('No overlay state on the Ask bar')
    },
    scene: () => undefined,
    actions: [],
    calls: local.calls,
  }
  return local.api
}
