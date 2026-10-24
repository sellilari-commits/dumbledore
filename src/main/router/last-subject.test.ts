/** Which subject a tap studies: the one extracted last, else the focus subject, else none. */
import type { Repos } from '@engine/contracts'
import { describe, expect, it } from 'vitest'
import { lastStudiedSubject } from './last-subject'

type Enc = { subjectId: string | null; inboxState: 'new' | 'accepted' | 'ignored' }

function repos(opts: { active: string[]; encounters: Enc[]; focus?: string | null }) {
  return {
    subjects: { list: () => opts.active.map((id) => ({ id })) },
    encounters: { list: () => opts.encounters },
    settings: { get: () => ({ focusSubjectId: opts.focus ?? null }) },
  } as unknown as Pick<Repos, 'encounters' | 'subjects' | 'settings'>
}

describe('lastStudiedSubject', () => {
  it('takes the subject of the newest encounter that has an active one', () => {
    const r = repos({
      active: ['bio', 'orgo'],
      encounters: [
        { subjectId: null, inboxState: 'new' },
        { subjectId: 'orgo', inboxState: 'ignored' },
        { subjectId: 'gone', inboxState: 'accepted' },
        { subjectId: 'bio', inboxState: 'new' },
        { subjectId: 'orgo', inboxState: 'accepted' },
      ],
      focus: 'orgo',
    })
    expect(lastStudiedSubject(r)).toBe('bio')
  })

  it('falls back to the focus subject, then to none', () => {
    expect(lastStudiedSubject(repos({ active: ['orgo'], encounters: [], focus: 'orgo' }))).toBe(
      'orgo',
    )
    expect(lastStudiedSubject(repos({ active: ['orgo'], encounters: [], focus: 'old' }))).toBeNull()
    expect(lastStudiedSubject(repos({ active: [], encounters: [], focus: 'orgo' }))).toBeNull()
  })
})
