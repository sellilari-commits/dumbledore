/** Conformance: EncounterRepo and EpisodeRepo. */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, encounterInput, episode } from './fixtures'

export function encounterSuite(t: () => ConformanceTarget): void {
  describe('encounters', () => {
    it('adds with id, clock time and inbox state "new" by default', () => {
      const { repos, clock } = t()
      const input = encounterInput({ openQuestions: ['Why?'], evidence: 're-read 3×' })
      const e = repos.encounters.add(input)
      expect(e).toEqual({
        ...input,
        id: expect.stringMatching(/^enc_/),
        inboxState: 'new',
        createdAt: clock.nowIso(),
      })
      expect(repos.encounters.add(encounterInput({ inboxState: 'accepted' })).inboxState).toBe(
        'accepted',
      )
    })

    it('lists newest first with subject, state, since and limit filters', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const old = repos.encounters.add(encounterInput({ subjectId: s.id }))
      clock.advance(60_000)
      const since = clock.nowIso()
      const mid = repos.encounters.add(encounterInput({ inboxState: 'accepted' }))
      clock.advance(60_000)
      const recent = repos.encounters.add(encounterInput({ subjectId: s.id }))

      expect(repos.encounters.list({}).map((e) => e.id)).toEqual([recent.id, mid.id, old.id])
      expect(repos.encounters.list({ subjectId: s.id }).map((e) => e.id)).toEqual([
        recent.id,
        old.id,
      ])
      expect(repos.encounters.list({ subjectId: null, inboxState: null })).toHaveLength(3)
      expect(repos.encounters.list({ inboxState: 'new' }).map((e) => e.id)).toEqual([
        recent.id,
        old.id,
      ])
      expect(repos.encounters.list({ sinceIso: since }).map((e) => e.id)).toEqual([
        recent.id,
        mid.id,
      ])
      expect(repos.encounters.list({ limit: 1 }).map((e) => e.id)).toEqual([recent.id])
    })

    it('breaks createdAt ties by id, descending', () => {
      const { repos } = t()
      const ids = [1, 2, 3, 4].map(() => repos.encounters.add(encounterInput()).id)
      expect(repos.encounters.list({}).map((e) => e.id)).toEqual([...ids].sort().reverse())
    })

    it('sets the inbox state and optionally the subject', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const e = repos.encounters.add(encounterInput({ subjectId: s.id }))
      expect(repos.encounters.setInboxState(e.id, 'accepted')).toMatchObject({
        inboxState: 'accepted',
        subjectId: s.id,
      })
      expect(repos.encounters.setInboxState(e.id, 'ignored', null)).toMatchObject({
        inboxState: 'ignored',
        subjectId: null,
      })
      expect(repos.encounters.setInboxState(e.id, 'new', s.id).subjectId).toBe(s.id)
      expect(repos.encounters.list({})[0]?.inboxState).toBe('new')
      expect(() => repos.encounters.setInboxState('enc_missing', 'accepted')).toThrow(/not found/)
    })

    it('collects distinct open questions, newest first, skipping ignored encounters', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const add = (openQuestions: string[], inboxState?: 'ignored') => {
        clock.advance(1000)
        return repos.encounters.add(encounterInput({ subjectId: s.id, openQuestions, inboxState }))
      }
      add(['Old question', 'Why tertiary?'])
      add(['Ignored question'], 'ignored')
      add(['why  TERTIARY?', 'Newest'])
      repos.encounters.add(encounterInput({ openQuestions: ['Other subject'] }))
      expect(repos.encounters.openQuestions(s.id, 10)).toEqual([
        'why  TERTIARY?',
        'Newest',
        'Old question',
      ])
      expect(repos.encounters.openQuestions(s.id, 2)).toEqual(['why  TERTIARY?', 'Newest'])
    })
  })
}

export function episodeSuite(t: () => ConformanceTarget): void {
  describe('episodes', () => {
    it('saves, reads back and replaces by id', () => {
      const { repos } = t()
      const ep = episode()
      repos.episodes.save(ep)
      expect(repos.episodes.get(ep.id)).toEqual(ep)
      repos.episodes.save({ ...ep, title: 'Updated', extracted: true })
      expect(repos.episodes.get(ep.id)).toEqual({ ...ep, title: 'Updated', extracted: true })
      expect(repos.episodes.get('epi_missing')).toBeNull()
    })

    it('lists unextracted episodes oldest first and marks them extracted', () => {
      const { repos } = t()
      repos.episodes.save(episode({ id: 'epi_b', endedAt: '2026-10-24T08:10:00.000Z' }))
      repos.episodes.save(episode({ id: 'epi_a', endedAt: '2026-10-24T08:05:00.000Z' }))
      repos.episodes.save(episode({ id: 'epi_c', endedAt: '2026-10-24T08:20:00.000Z' }))
      repos.episodes.save(episode({ id: 'epi_x', extracted: true }))
      expect(repos.episodes.listUnextracted(10).map((e) => e.id)).toEqual([
        'epi_a',
        'epi_b',
        'epi_c',
      ])
      repos.episodes.markExtracted('epi_a')
      expect(repos.episodes.listUnextracted(1).map((e) => e.id)).toEqual(['epi_b'])
      expect(repos.episodes.get('epi_a')?.extracted).toBe(true)
      expect(() => repos.episodes.markExtracted('epi_missing')).toThrow(/not found/)
    })

    it('lists recent episodes newest first', () => {
      const { repos } = t()
      repos.episodes.save(episode({ id: 'epi_old', endedAt: '2026-10-23T08:00:00.000Z' }))
      repos.episodes.save(episode({ id: 'epi_1', endedAt: '2026-10-24T08:00:00.000Z' }))
      repos.episodes.save(episode({ id: 'epi_2', endedAt: '2026-10-24T08:30:00.000Z' }))
      const since = '2026-10-24T00:00:00.000Z'
      expect(repos.episodes.recent({ sinceIso: since }).map((e) => e.id)).toEqual([
        'epi_2',
        'epi_1',
      ])
      expect(repos.episodes.recent({ sinceIso: since, limit: 1 }).map((e) => e.id)).toEqual([
        'epi_2',
      ])
    })

    it('purges text of episodes that ended before a time, keeping metadata', () => {
      const { repos } = t()
      repos.episodes.save(episode({ id: 'epi_old', endedAt: '2026-10-20T08:00:00.000Z' }))
      repos.episodes.save(
        episode({ id: 'epi_blank', endedAt: '2026-10-20T08:00:00.000Z', text: '' }),
      )
      repos.episodes.save(episode({ id: 'epi_new', endedAt: '2026-10-24T08:00:00.000Z' }))
      expect(repos.episodes.purgeTextOlderThan('2026-10-22T00:00:00.000Z')).toBe(1)
      expect(repos.episodes.get('epi_old')).toMatchObject({
        text: '',
        dwellSeconds: 360,
        app: 'Chrome',
      })
      expect(repos.episodes.get('epi_new')?.text).not.toBe('')
      expect(repos.episodes.purgeTextOlderThan('2026-10-22T00:00:00.000Z')).toBe(0)
    })
  })
}
