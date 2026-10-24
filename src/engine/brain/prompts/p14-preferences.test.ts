import { describe, expect, it } from 'vitest'
import { buildPreferencesUser, finalizePreferences, preferencesPrompt } from './p14-preferences'

const input = {
  subject: { name: 'Chemistry', goal: 'Pass the midterm' },
  language: 'en',
  concepts: [
    { id: 'con_sub', name: 'Substitution', parentId: null },
    { id: 'con_sn1', name: 'SN1', parentId: 'con_sub' },
    { id: 'con_sn2', name: 'SN2', parentId: 'con_sub' },
  ],
  current: { focus: ['con_sn1'], skip: ['con_gone'] },
  instruction: 'not SN2, and add radicals',
}

describe('P14 study preferences', () => {
  it('lists the tree and stored wishes as short refs', () => {
    const user = buildPreferencesUser(input)
    expect(user).toContain('Chemistry · goal: Pass the midterm')
    expect(user).toContain('c1 Substitution < -\nc2 SN1 < c1\nc3 SN2 < c1')
    // A stored id that no longer exists is not shown.
    expect(user).toContain('focus: c2\nskip: (none)')
    expect(user).toContain('not SN2, and add radicals')
    expect(preferencesPrompt.tier).toBe('triage')
  })

  it('maps refs back to ids and trims names; unknown refs pass through for validation', () => {
    expect(
      finalizePreferences(
        {
          replace: false,
          focus: [' c2 '],
          skip: ['c3', 'c9'],
          focusNames: [' Radicals ', ''],
          skipNames: [],
        },
        input,
      ),
    ).toEqual({
      replace: false,
      focus: ['con_sn1'],
      skip: ['con_sn2', 'c9'],
      focusNames: ['Radicals'],
      skipNames: [],
    })
  })
})
