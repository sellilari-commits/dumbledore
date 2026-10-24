import type { Concept } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import type { StudyPreferences } from '../../contracts'
import { mergePreferences, withDescendants } from './preferences'

const NOW = '2026-10-25T09:00:00.000Z'
const concept = (id: string, parentId: string | null = null) => ({ id, parentId }) as Concept
const CONCEPTS = [
  concept('c_sub'),
  concept('c_sn1', 'c_sub'),
  concept('c_sn2', 'c_sub'),
  concept('c_kin'),
]
const empty = { replace: false, focus: [], skip: [], focusNames: [], skipNames: [] }

const stored: StudyPreferences = {
  instruction: 'SN1, not SN2',
  focus: ['c_sn1'],
  skip: ['c_sn2'],
  focusNames: ['Solvolysis'],
  skipNames: [],
  updatedAt: '2026-10-24T09:00:00.000Z',
}

describe('mergePreferences', () => {
  it('drops unknown ids and keeps a concept named in both lists as wanted', () => {
    const p = mergePreferences({
      current: null,
      mapped: { ...empty, focus: ['c_sn1', 'c_gone', 'c_sn1'], skip: ['c_sn1', 'c_kin', 'x'] },
      concepts: CONCEPTS,
      instruction: ' SN1, no kinetics ',
      nowIso: NOW,
    })
    expect(p).toEqual({
      instruction: 'SN1, no kinetics',
      focus: ['c_sn1'],
      skip: ['c_kin'],
      focusNames: [],
      skipNames: [],
      updatedAt: NOW,
    })
  })

  it('adds to the stored wishes and moves a concept between focus and skip', () => {
    const p = mergePreferences({
      current: stored,
      mapped: { ...empty, focus: ['c_sn2'], skipNames: ['Solvolysis'] },
      concepts: CONCEPTS,
      instruction: 'actually SN2 too',
      nowIso: NOW,
    })
    expect(p.focus).toEqual(['c_sn1', 'c_sn2'])
    expect(p.skip).toEqual([])
    expect(p.focusNames).toEqual([])
    expect(p.skipNames).toEqual(['Solvolysis'])
    expect(p.instruction).toBe('SN1, not SN2 · actually SN2 too')
  })

  it('starts over when the model says replace, and forgets concepts that are gone', () => {
    const replaced = mergePreferences({
      current: stored,
      mapped: { ...empty, replace: true, focus: ['c_kin'] },
      concepts: CONCEPTS,
      instruction: 'forget that, only kinetics',
      nowIso: NOW,
    })
    expect(replaced).toMatchObject({
      instruction: 'forget that, only kinetics',
      focus: ['c_kin'],
      skip: [],
      focusNames: [],
    })
    const pruned = mergePreferences({
      current: stored,
      mapped: empty,
      concepts: [concept('c_sn2')],
      instruction: 'SN1, not SN2',
      nowIso: NOW,
    })
    expect(pruned.focus).toEqual([])
    expect(pruned.skip).toEqual(['c_sn2'])
    expect(pruned.instruction).toBe('SN1, not SN2')
  })
})

describe('withDescendants', () => {
  it('covers everything under a topic', () => {
    expect([...withDescendants(['c_sub'], CONCEPTS)].sort()).toEqual(['c_sn1', 'c_sn2', 'c_sub'])
    expect([...withDescendants(['c_kin'], CONCEPTS)]).toEqual(['c_kin'])
  })
})
