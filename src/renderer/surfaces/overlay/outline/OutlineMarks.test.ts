import { describe, expect, it } from 'vitest'
import { basisText, elsewhereText, paddings } from './OutlineMarks'

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

describe('basisText', () => {
  it('says what the marks are chosen for and how much of the page was read', () => {
    expect(
      basisText({
        goal: 'Pass the midterm',
        gaps: ['Carbocation stability'],
        questions: 2,
        lines: 312,
        offScreen: 280,
      }),
    ).toBe('For your goal and gaps (Carbocation stability) · read the whole page')
    expect(basisText({ goal: null, gaps: [], questions: 0, lines: 40, offScreen: 0 })).toBe(
      'For this subject · read what’s on screen',
    )
    expect(basisText({ goal: 'Pass', gaps: [], questions: 0, lines: 9, offScreen: 2 })).toBe(
      'For your goal “Pass” · read the whole page',
    )
  })
})
