import { describe, expect, it } from 'vitest'
import { minutesLeft, stepMinutes } from './TimerButton'

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
