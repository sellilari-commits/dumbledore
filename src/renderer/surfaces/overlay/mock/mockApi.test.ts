import type { OverlayState } from '@shared/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockApi } from './mockApi'
import { NUDGE, SCENES, sceneState } from './scenes'

const vp = { width: 1280, height: 800 }

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
  delete window.__ddMock
})

describe('mock driver', () => {
  it('every scene is a valid, distinct OverlayState', () => {
    for (const name of SCENES) {
      const s = sceneState(name, vp)
      expect(s.displayId).toBe(1)
      expect(s.orb.size).toBeGreaterThan(0)
    }
    expect(sceneState('docked', vp).dockTarget).not.toBeNull()
    expect(sceneState('quiz', vp).quiz?.quizId).toBe('quiz_demo')
  })

  it('serves a pinned scene and reacts to actions like a small main', async () => {
    window.history.replaceState(null, '', '/overlay.html?scene=toast')
    const api = createMockApi('overlay')
    const states: OverlayState[] = []
    api.on('overlay.changed', (s) => states.push(s))
    expect((await api.invoke('overlay.getState')).toasts).toHaveLength(1)

    await api.invoke('overlay.action', { type: 'toastDismiss', toastId: NUDGE.id })
    expect(states.at(-1)?.orb.dot).toBe('orange')

    await api.invoke('overlay.action', { type: 'orbDrag', x: 100, y: 300, done: true })
    expect(states.at(-1)).toMatchObject({ edge: 'left', orb: { x: 32, y: 300 } })
    expect(window.__ddMock?.actions.map((a) => a.type)).toEqual(['toastDismiss', 'orbDrag'])
  })

  it('plays the tour when no scene is pinned', async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/overlay.html')
    const api = createMockApi('overlay')
    const states: OverlayState[] = []
    api.on('overlay.changed', (s) => states.push(s))
    vi.advanceTimersByTime(3300)
    expect(states).toHaveLength(1)
    expect(states[0]?.pill).not.toBeNull()
  })

  it('answers quiz and ask calls from fixtures', async () => {
    window.history.replaceState(null, '', '/overlay.html?scene=quiz')
    const api = createMockApi('overlay')
    const quiz = await api.invoke('quiz.get', 'quiz_demo')
    expect(quiz.questions).toHaveLength(4)
    const answer = await api.invoke('quiz.answer', {
      quizId: 'quiz_demo',
      questionId: 'q1',
      chosenIndex: 3,
    })
    expect(answer.correct).toBe(true)
    expect((await api.invoke('quiz.finish', 'quiz_demo')).correct).toBe(1)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const ask = createMockApi('askbar')
    const deltas: string[] = []
    ask.on('chat.delta', (d) => deltas.push(d.delta))
    const pending = ask.invoke('ask.submit', { text: 'recursion' })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(deltas.join('')).toBe(result.reply)
    expect(result.actions.length).toBeGreaterThan(0)
  })
})
