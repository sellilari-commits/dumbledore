/** Which subject a tap studies: the one extracted last, else the focus subject, else none. */
import type { Repos } from '@engine/contracts'
import { describe, expect, it } from 'vitest'
import { lastStudiedSubject, tapTarget } from './last-subject'

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

type C = {
  id: string
  subjectId: string
  name: string
  parentId: string | null
  lastSeenAt: string | null
}

function topicRepos(opts: {
  subjects: { id: string; status: 'active' | 'suggested' }[]
  concepts: C[]
  locked?: string | null
  encounters?: Enc[]
}) {
  return {
    subjects: {
      list: (f?: { status?: string[] }) =>
        opts.subjects
          .filter((s) => !f?.status || f.status.includes(s.status))
          .map((s) => ({ ...s, name: s.id })),
    },
    concepts: { listBySubject: (id: string) => opts.concepts.filter((c) => c.subjectId === id) },
    encounters: { list: () => opts.encounters ?? [] },
    settings: { get: () => ({ focusSubjectId: null, focusTopicId: opts.locked ?? null }) },
  } as unknown as Pick<Repos, 'encounters' | 'subjects' | 'settings' | 'concepts'>
}

const c = (
  id: string,
  subjectId: string,
  lastSeenAt: string | null,
  parentId: string | null = null,
): C => ({
  id,
  subjectId,
  name: id,
  parentId,
  lastSeenAt,
})

describe('tapTarget', () => {
  const subjects = [
    { id: 'stats', status: 'active' as const },
    { id: 'orgo', status: 'active' as const },
  ]
  const concepts = [
    c('Research Methods', 'stats', '2026-10-24T10:00:00Z'),
    c('SN1', 'orgo', '2026-10-24T12:00:00Z'),
    c('Leaving groups', 'orgo', '2026-10-24T13:00:00Z', 'SN1'),
  ]

  it('unlocked: the subject of the newest topic, as a whole', () => {
    expect(tapTarget(topicRepos({ subjects, concepts }))).toEqual({ subjectId: 'orgo', goal: null })
  })

  it('locked: that topic, by name, in its subject', () => {
    const r = topicRepos({ subjects, concepts, locked: 'Research Methods' })
    expect(tapTarget(r)).toEqual({ subjectId: 'stats', goal: 'Research Methods' })
  })

  it('a locked topic that is gone follows the latest again', () => {
    const r = topicRepos({ subjects, concepts, locked: 'deleted' })
    expect(tapTarget(r)).toEqual({ subjectId: 'orgo', goal: null })
  })

  it('without topics falls back to the last studied subject, else none', () => {
    const r = topicRepos({
      subjects,
      concepts: [],
      encounters: [{ subjectId: 'stats', inboxState: 'new' }],
    })
    expect(tapTarget(r)).toEqual({ subjectId: 'stats', goal: null })
    expect(tapTarget(topicRepos({ subjects: [], concepts: [] }))).toBeNull()
  })
})
