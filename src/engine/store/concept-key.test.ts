/** conceptKey / singularize / isNicerName: what counts as the same concept name. */
import { describe, expect, it } from 'vitest'
import { conceptKey, isNicerName, singularize } from './concept-key'

describe('singularize', () => {
  it('leaves words that only look plural alone', () => {
    const words = [
      'analysis',
      'synthesis',
      'mass',
      'process',
      'nucleus',
      'species',
      'series',
      'physics',
      'gas',
      'bias',
      'status',
      'axis',
      'news',
      'lens',
      'means',
      'chaos',
      'atlas',
      'mathematics',
      'this',
      'thus',
      'its',
      'is',
      '1990s',
    ]
    for (const w of words) expect(singularize(w), w).toBe(w)
  })

  it('handles simple and common irregular plurals', () => {
    const pairs: [string, string][] = [
      ['nucleophiles', 'nucleophile'],
      ['groups', 'group'],
      ['mechanisms', 'mechanism'],
      ['properties', 'property'],
      ['processes', 'process'],
      ['masses', 'mass'],
      ['gases', 'gas'],
      ['biases', 'bias'],
      ['viruses', 'virus'],
      ['statuses', 'status'],
      ['analyses', 'analysis'],
      ['hypotheses', 'hypothesis'],
      ['boxes', 'box'],
      ['matches', 'match'],
      ['bases', 'base'],
      ['causes', 'cause'],
      ['curves', 'curve'],
      ['volcanoes', 'volcano'],
      ['shoes', 'shoe'],
      ['leaves', 'leaf'],
      ['nuclei', 'nucleus'],
      ['bacteria', 'bacterium'],
      ['matrices', 'matrix'],
      ['ideas', 'idea'],
    ]
    for (const [plural, singular] of pairs) expect(singularize(plural), plural).toBe(singular)
  })
})

describe('conceptKey', () => {
  const same = (a: string, b: string) => expect(conceptKey(a), `${a} = ${b}`).toBe(conceptKey(b))
  const differ = (a: string, b: string) =>
    expect(conceptKey(a), `${a} ≠ ${b}`).not.toBe(conceptKey(b))

  it('ignores case, spacing, hyphens, punctuation and plurals', () => {
    same('Leaving groups', 'Leaving Group')
    same('leaving-group', ' LEAVING  GROUPS ')
    same('nucleophiles', 'Nucleophile')
    same('SN2 mechanism', 'SN2 Mechanism')
    same('SN-2 mechanisms', 'sn2 mechanism.')
    same('Nucleophiles vs. Leaving Groups', 'Nucleophile vs Leaving Group')
    same("Hess's law", 'Hess law')
    same('Markovnikov’s rule', 'Markovnikov rule')
    same('Acids & bases', 'acid and base')
    same('APIs', 'API')
    same('SN2s', 'SN2')
    same('H₂O', 'H2O')
    same('`useEffect` hook', 'useEffect hook')
  })

  it('keeps different concepts apart', () => {
    differ('Physics', 'Physic')
    differ('Species', 'Specie')
    differ('Gas', 'Ga')
    differ('Mass', 'Mas')
    differ('C++', 'C')
    differ('C#', 'C')
    differ('Na+', 'Na')
    differ('x^2', 'x2')
    differ('SN1', 'SN2')
    differ('1s orbital', '1 orbital')
    differ('1990s', '1990')
  })

  it('falls back to the normalized name when nothing is left', () => {
    expect(conceptKey(' ?! ')).toBe('?!')
    differ('?', '!')
  })
})

describe('isNicerName', () => {
  it('prefers a capitalized name over an all-lowercase one, nothing else', () => {
    expect(isNicerName('nucleophiles', 'Nucleophile')).toBe(true)
    expect(isNicerName('Leaving groups', 'Leaving Group')).toBe(false)
    expect(isNicerName('SN2 Mechanism', 'SN2 mechanism')).toBe(false)
    expect(isNicerName('backside attack', 'backside attacks')).toBe(false)
    expect(isNicerName('x', '  ')).toBe(false)
  })
})
