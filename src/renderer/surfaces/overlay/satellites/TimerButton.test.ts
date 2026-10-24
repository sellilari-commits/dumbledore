import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { minutesLeft, stepMinutes, TimerEdge, timerElapsed } from './TimerButton'

describe('timer maths', () => {
  it('steps by 1 up to 10 minutes, then by 5, within 1–180', () => {
    expect(stepMinutes(1, -1)).toBe(1)
    expect(stepMinutes(1, 1)).toBe(2)
    expect(stepMinutes(9, 1)).toBe(10)
    expect(stepMinutes(10, 1)).toBe(15)
    expect(stepMinutes(15, -1)).toBe(10)
    expect(stepMinutes(10, -1)).toBe(9)
    expect(stepMinutes(25, 1)).toBe(30)
    expect(stepMinutes(180, 1)).toBe(180)
  })

  it('rounds minutes left up so "1" shows until the end', () => {
    const now = Date.parse('2026-10-25T10:00:00Z')
    expect(minutesLeft('2026-10-25T10:00:30Z', now)).toBe(1)
    expect(minutesLeft('2026-10-25T10:18:00Z', now)).toBe(18)
    expect(minutesLeft('2026-10-25T09:59:00Z', now)).toBe(0)
  })
})

describe('timer progress edge', () => {
  const start = Date.parse('2026-10-25T10:00:00Z')
  const at = (min: number) => start + min * 60_000
  const timer = (totalMin: number) => ({
    startedAt: new Date(start).toISOString(),
    endsAt: new Date(at(totalMin)).toISOString(),
  })

  it('grows from 0 at the start to 1 at the end', () => {
    expect(timerElapsed(timer(20), at(0))).toBe(0)
    expect(timerElapsed(timer(20), at(10))).toBe(0.5)
    expect(timerElapsed(timer(20), at(20))).toBe(1)
    expect(timerElapsed(timer(20), at(25))).toBe(1)
    expect(timerElapsed(timer(20), at(-1))).toBe(0)
  })

  it('rescales against the new total after +5 or −5 minutes', () => {
    // 10 of 20 minutes gone, then +5: 10 of 25. Then −10 from there: 10 of 15.
    expect(timerElapsed(timer(25), at(10))).toBeCloseTo(0.4)
    expect(timerElapsed(timer(15), at(10))).toBeCloseTo(2 / 3)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('glides by default, and is marked to jump per second under reduced motion', () => {
    const media = (reduce: boolean) => () => ({ matches: reduce }) as MediaQueryList
    vi.stubGlobal('matchMedia', media(false))
    const smooth = render(createElement(TimerEdge, { value: 0.5 }))
    const edge = smooth.getByTestId('timer-edge')
    expect(edge.hasAttribute('data-reduced')).toBe(false)
    expect(edge.querySelector('path')?.getAttribute('stroke-dashoffset')).toBe('0.5')
    smooth.unmount()
    vi.stubGlobal('matchMedia', media(true))
    const reduced = render(createElement(TimerEdge, { value: 0.5 }))
    expect(reduced.getByTestId('timer-edge').hasAttribute('data-reduced')).toBe(true)
  })
})
