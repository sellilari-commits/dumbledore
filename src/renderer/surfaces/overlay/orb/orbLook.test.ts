import { describe, expect, it } from 'vitest'
import { state } from '../testing/fakeApi'
import { orbLabel, orbLook } from './orbLook'

describe('orbLook', () => {
  it('idle: a plain 40 pt orb', () => {
    expect(orbLook(state('idle').orb)).toEqual({
      size: 40,
      docked: false,
      paused: false,
      thinking: false,
      progress: null,
      dot: 'none',
    })
  })

  it('maps every visual', () => {
    expect(orbLook(state('paused').orb).paused).toBe(true)
    expect(orbLook(state('thinking').orb).thinking).toBe(true)
    expect(orbLook(state('attention').orb).dot).toBe('orange')
    expect(orbLook(state('session').orb).progress).toBeCloseTo(3 / 8)
    expect(orbLook(state('docked').orb)).toMatchObject({ docked: true, size: 28 })
  })

  it('combines states and falls back on visual alone', () => {
    const orb = { ...state('session').orb, thinking: true, dot: 'blue' as const }
    expect(orbLook(orb)).toMatchObject({ thinking: true, dot: 'blue', progress: 3 / 8 })
    const bare = { ...state('idle').orb, visual: 'docked' as const, size: 0 }
    expect(orbLook(bare)).toMatchObject({ docked: true, size: 28 })
    const attention = { ...state('idle').orb, visual: 'attention' as const }
    expect(orbLook(attention).dot).toBe('orange')
  })

  it('clamps progress and ignores an empty session', () => {
    expect(orbLook({ ...state('idle').orb, progress: { k: 9, n: 8 } }).progress).toBe(1)
    expect(orbLook({ ...state('idle').orb, progress: { k: 0, n: 0 } }).progress).toBeNull()
  })

  it('names the status for screen readers', () => {
    const orb = state('session').orb
    expect(orbLabel(orbLook(orb), orb)).toBe('Dumbledore, step 3 of 8')
  })
})
