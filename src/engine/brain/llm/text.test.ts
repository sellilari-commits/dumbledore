import { describe, expect, it } from 'vitest'
import { clip, clipTail, countWords, estimateTokens, looksFinnish, resolveLanguage } from './text'

describe('looksFinnish', () => {
  it('detects Finnish study text', () => {
    expect(
      looksFinnish(
        'Fotosynteesi on prosessi, jossa kasvit muuttavat valoenergiaa kemialliseksi energiaksi. En ymmärrä miten Calvinin kierto toimii.',
      ),
    ).toBe(true)
    expect(looksFinnish('Selitä minulle derivaatta ja anna esimerkki')).toBe(true)
  })

  it('does not flag English or German text', () => {
    expect(
      looksFinnish(
        'The SN1 reaction is a substitution reaction in organic chemistry; rate = k[R-X].',
      ),
    ).toBe(false)
    expect(
      looksFinnish('Die Mitochondrien sind die Kraftwerke der Zelle und für die Atmung wichtig.'),
    ).toBe(false)
  })

  it('resolves explicit hints first', () => {
    expect(resolveLanguage('fi', 'hello world')).toBe('fi')
    expect(resolveLanguage('auto', 'En ymmärrä tätä tehtävää ollenkaan, auta minua')).toBe('fi')
    expect(resolveLanguage(undefined, 'Explain the Calvin cycle')).toBe('en')
  })
})

describe('text helpers', () => {
  it('estimates tokens conservatively', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a'.repeat(350))).toBe(100)
    expect(estimateTokens('ä'.repeat(30))).toBe(20)
  })

  it('counts words and clips with markers', () => {
    expect(countWords(' one  two\nthree ')).toBe(3)
    const long = `${'a'.repeat(100)}${'b'.repeat(100)}`
    const c = clip(long, 50)
    expect(c.length).toBeLessThanOrEqual(52)
    expect(c).toContain('[…]')
    expect(c.startsWith('a')).toBe(true)
    expect(c.endsWith('b')).toBe(true)
    expect(clipTail(long, 20)).toMatch(/^\[…\]b+$/)
    expect(clip('short', 50)).toBe('short')
  })
})
