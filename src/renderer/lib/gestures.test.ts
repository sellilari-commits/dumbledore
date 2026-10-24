/** Clean-tap detector over DOM key events: tap, double-tap, hold, chords and slow presses. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGestureDetector, DEFAULT_TIMING, type KeyGesture } from './gestures'

let t = 0
let seen: KeyGesture[] = []
const detector = () =>
  createGestureDetector(
    DEFAULT_TIMING,
    (g) => seen.push(g),
    () => t,
  )
const key = (code: string) => ({ code, repeat: false })

beforeEach(() => {
  vi.useFakeTimers()
  t = 0
  seen = []
})
afterEach(() => vi.useRealTimers())

function press(d: ReturnType<typeof detector>, code: string, ms: number) {
  d.keydown(key(code))
  t += ms
  vi.advanceTimersByTime(ms)
  d.keyup(key(code))
}

describe('createGestureDetector', () => {
  it('reports a quick press as a tap of that key', () => {
    const d = detector()
    press(d, 'AltRight', 120)
    press(d, 'AltLeft', 100)
    expect(seen).toEqual([
      { gesture: 'tap', key: 'rightOption' },
      { gesture: 'tap', key: 'leftOption' },
    ])
  })

  it('turns two quick taps into a double-tap', () => {
    const d = detector()
    press(d, 'AltRight', 80)
    t += 100
    press(d, 'AltRight', 80)
    expect(seen.map((g) => g.gesture)).toEqual(['tap', 'doubleTap'])
  })

  it('reports a hold as holdStart then holdEnd', () => {
    const d = detector()
    press(d, 'AltRight', 800)
    expect(seen).toEqual([
      { gesture: 'holdStart', key: 'rightOption' },
      { gesture: 'holdEnd', key: 'rightOption' },
    ])
  })

  it('ignores chords (⌥2) and presses too slow for a tap but too short for a hold', () => {
    const d = detector()
    d.keydown(key('AltRight'))
    d.keydown(key('Digit2'))
    d.keyup(key('Digit2'))
    t += 100
    d.keyup(key('AltRight'))
    press(d, 'AltRight', 420)
    expect(seen).toEqual([])
  })

  it('forgets a press when reset (window lost focus)', () => {
    const d = detector()
    d.keydown(key('AltRight'))
    d.reset()
    t += 900
    vi.advanceTimersByTime(900)
    d.keyup(key('AltRight'))
    expect(seen).toEqual([])
  })
})
