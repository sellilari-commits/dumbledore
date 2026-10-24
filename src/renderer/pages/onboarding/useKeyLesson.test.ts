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

  it('counts the backup chord as a tap (it always works)', () => {
    const s = react(start, { gesture: 'tap', key: 'fallbackChord' }, 'rightOption')
    expect(s.tapped).toBe(true)
    expect(s.verdict.tone).toBe('good')
    expect(s.verdict.text).toContain('backup chord')
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
    expect(s.verdict.text).toMatch(/it writes the prompt\. Now double-tap it/)
    s = react(s, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    expect(s.verdict.text).toBe('That’s a tap. Now double-tap it: two quick taps.')
  })

  it('explains a hold as the prompt box, before and after the first tap', () => {
    const early = react(start, { gesture: 'holdStart', key: 'rightOption' }, 'rightOption')
    expect(early.verdict.text).toMatch(
      /^That’s a hold — tell Dumbledore what you want, it writes the prompt\. First a quick tap/,
    )
    const tapped = react(start, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    const holding = react(tapped, { gesture: 'holdStart', key: 'rightOption' }, 'rightOption')
    expect(holding.verdict.text).toBe(
      'Holding… now tell Dumbledore what you want, it writes the prompt.',
    )
  })

  it('accepts a double-tap as a tap and says it opens the chat', () => {
    const s = react(start, { gesture: 'doubleTap', key: 'rightOption' }, 'rightOption')
    expect([s.tapped, s.doubled]).toEqual([true, true])
    expect(s.verdict.text).toBe(
      'That’s a double-tap: it opens a chat with Dumbledore. Now hold it for half a second.',
    )
  })

  it('celebrates once tap, hold and double-tap are all done', () => {
    let s = react(start, { gesture: 'tap', key: 'rightOption' }, 'rightOption')
    s = react(s, { gesture: 'holdStart', key: 'rightOption' }, 'rightOption')
    s = react(s, { gesture: 'holdEnd', key: 'rightOption' }, 'rightOption')
    s = react(s, { gesture: 'doubleTap', key: 'rightOption' }, 'rightOption')
    expect([s.tapped, s.held, s.doubled]).toEqual([true, true, true])
    expect(s.verdict.text).toMatch(/you’ve got all three\.$/)
  })
})
