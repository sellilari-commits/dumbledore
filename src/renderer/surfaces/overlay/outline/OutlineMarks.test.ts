import { describe, expect, it } from 'vitest'
import { elsewhereText, paddings } from './OutlineMarks'

describe('paddings', () => {
  it('keeps the full padding when passages are far apart', () => {
    expect(
      paddings([
        { y: 0, height: 40 },
        { y: 200, height: 20 },
      ]),
    ).toEqual([
      { top: 7, bottom: 7 },
      { top: 7, bottom: 7 },
    ])
  })

  it('shrinks the facing sides of close neighbours so their shapes keep a gap', () => {
    // 10 pt between the passages: each side gets (10 - 6) / 2 = 2.
    const [a, b] = paddings([
      { y: 0, height: 20 },
      { y: 30, height: 20 },
    ])
    expect(a).toEqual({ top: 7, bottom: 2 })
    expect(b).toEqual({ top: 2, bottom: 7 })
  })

  it('never pads below zero when passages touch', () => {
    const [a, b] = paddings([
      { y: 0, height: 20 },
      { y: 20, height: 20 },
    ])
    expect(a?.bottom).toBe(0)
    expect(b?.top).toBe(0)
  })
})

describe('elsewhereText', () => {
  it('points the way to passages that are off screen', () => {
    expect(elsewhereText(0, 2)).toBe('↓ 2 more further down.')
    expect(elsewhereText(1, 0)).toBe('↑ 1 more further up.')
    expect(elsewhereText(1, 2)).toBe('3 more further up and down.')
    expect(elsewhereText(0, 0)).toBe('')
  })
})
