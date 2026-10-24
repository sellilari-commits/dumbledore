/** Inbox helpers: source icons, the meta line and whether a row stays in view after an action. */
import type { Encounter } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { sourceKind, sourceMeta, staysInView, UNFILED } from './inbox-utils'

const enc = (over: Partial<Encounter> = {}): Encounter => ({
  id: 'e1',
  subjectId: 'sub_orgo',
  conceptId: null,
  episodeId: null,
  seen: 'x',
  bigPicture: 'y',
  topicPath: [],
  understanding: 'unknown',
  evidence: '',
  openQuestions: [],
  keyTerms: [],
  source: {
    app: 'Google Chrome',
    bundleId: null,
    url: 'https://www.youtube.com/watch?v=1',
    title: 'T',
  },
  dwellSeconds: 420,
  inboxState: 'new',
  createdAt: new Date().toISOString(),
  ...over,
})

describe('inbox-utils', () => {
  it('picks an icon kind from the app and host', () => {
    expect(sourceKind(enc().source)).toBe('video')
    expect(sourceKind({ app: 'ChatGPT', bundleId: null, url: null, title: null })).toBe('ai')
    expect(sourceKind({ app: 'Preview', bundleId: null, url: null, title: 'a.pdf' })).toBe(
      'document',
    )
    expect(sourceKind({ app: 'Notion', bundleId: null, url: null, title: null })).toBe('notes')
    expect(sourceKind({ app: 'Safari', bundleId: null, url: 'https://a.org', title: null })).toBe(
      'web',
    )
  })

  it('writes the source meta line', () => {
    expect(sourceMeta(enc())).toBe('Google Chrome · youtube.com · 7 min')
  })

  it('knows when an acted-on row leaves the current view', () => {
    const all = { state: 'all' as const, subject: null }
    expect(staysInView(enc(), 'accept', null, { state: 'new', subject: null })).toBe(false)
    expect(staysInView(enc(), 'ignore', null, all)).toBe(true)
    expect(staysInView(enc(), 'accept', null, { state: 'accepted', subject: null })).toBe(true)
    expect(staysInView(enc(), 'assign', 'sub_linalg', { state: 'all', subject: 'sub_orgo' })).toBe(
      false,
    )
    expect(
      staysInView(enc({ subjectId: null }), 'accept', null, { state: 'all', subject: UNFILED }),
    ).toBe(true)
  })
})
