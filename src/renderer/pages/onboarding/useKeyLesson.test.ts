/** The key lesson's coaching rules, gesture by gesture. */
import { describe, expect, it } from 'vitest'
import { initialLesson, keyName, react } from './useKeyLesson'

const start = initialLesson('rightOption')

describe('key lesson', () => {
  it('names keys the way a student says them', () => {
    expect(keyName('rightOption')).toBe('right ⌥')
    expect(keyName('leftCommand')).toBe('left ⌘')
    expect(keyName('mystery')).toBe('mystery')
  })

  it('passes on a clean tap of the configured key', () => {
    const s = react(start, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    expect(s.tapped).toBe(true)
    expect(s.presses).toBe(1)
    expect(s.verdict.tone).toBe('good')
  })

  it('corrects the wrong key without passing', () => {
    const s = react(start, { gesture: 'tap', key: 'leftOption' }, 'rightOption')
    expect(s.tapped).toBe(false)
    expect(s.verdict).toEqual({
      tone: 'warn',
      text: 'That’s left ⌥ — tap right ⌥ instead.',
    })
  })

  it('explains a hold before the first tap, and counts one after it', () => {
    const early = react(start, { gesture: 'holdStart', key: 'rightOption' }, 'rightOption')
    expect(early.down).toBe(true)
    expect(early.verdict.tone).toBe('warn')
    const released = react(early, { gesture: 'holdEnd', key: 'rightOption' }, 'rightOption')
    expect(released.held).toBe(false)

    let s = react(start, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    s = react(s, { gesture: 'holdStart', key: 'rightOption' }, 'rightOption')
    s = react(s, { gesture: 'holdEnd', key: 'rightOption' }, 'rightOption')
    expect([s.tapped, s.held, s.down]).toEqual([true, true, false])
    s = react(s, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    expect(s.verdict.text).toBe('Tap and hold — you’ve got both.')
  })

  it('accepts a double-tap as a tap and says what it does', () => {
    const s = react(start, { gesture: 'doubleTap', key: 'rightOption' }, 'rightOption')
    expect(s.tapped).toBe(true)
    expect(s.verdict.text).toMatch(/double-tap opens the Ask bar/)
  })
})
