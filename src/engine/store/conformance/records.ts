/** Conformance: assignments, nudges, chat, profile, settings and LLM usage. */
import { DEFAULT_SETTINGS } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, llmCall } from './fixtures'

export function recordSuite(t: () => ConformanceTarget): void {
  describe('assignments', () => {
    it('upserts, de-duplicating on normalized title + due date', () => {
      const { repos, clock } = t()
      const a = repos.assignments.upsert({
        subjectId: null,
        title: ' Problem Set 5 ',
        dueAt: '2026-10-27',
        source: 'canvas',
      })
      expect(a).toEqual({
        id: expect.stringMatching(/^asg_/),
        subjectId: null,
        title: 'Problem Set 5',
        course: null,
        dueAt: '2026-10-27',
        source: 'canvas',
        status: 'open',
        createdAt: clock.nowIso(),
      })
      expect(
        repos.assignments.upsert({
          subjectId: 'x',
          title: 'problem  set 5',
          dueAt: '2026-10-27',
          source: 'y',
        }),
      ).toEqual(a)
      expect(
        repos.assignments.upsert({
          subjectId: null,
          title: 'Problem Set 5',
          dueAt: null,
          source: 'y',
        }).id,
      ).not.toBe(a.id)
      expect(
        repos.assignments.upsert({
          subjectId: null,
          title: 'PROBLEM SET 5',
          dueAt: null,
          source: 'z',
        }).source,
      ).toBe('y')
      expect(repos.assignments.list({})).toHaveLength(2)
    })

    it('lists by due date (undated last) with status/subject filters and updates', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const late = repos.assignments.upsert({
        subjectId: s.id,
        title: 'Late',
        dueAt: '2026-11-01',
        source: 'm',
      })
      const none = repos.assignments.upsert({
        subjectId: null,
        title: 'Undated',
        dueAt: null,
        source: 'm',
      })
      const soon = repos.assignments.upsert({
        subjectId: s.id,
        title: 'Soon',
        dueAt: '2026-10-25',
        source: 'm',
      })
      expect(repos.assignments.list({}).map((a) => a.id)).toEqual([soon.id, late.id, none.id])
      expect(repos.assignments.list({ subjectId: s.id, limit: 1 }).map((a) => a.id)).toEqual([
        soon.id,
      ])
      const done = repos.assignments.update(soon.id, { status: 'done', title: 'Soon!' })
      expect(done).toMatchObject({
        id: soon.id,
        status: 'done',
        title: 'Soon!',
        dueAt: '2026-10-25',
      })
      expect(repos.assignments.list({ status: 'open' }).map((a) => a.id)).toEqual([
        late.id,
        none.id,
      ])
      expect(() => repos.assignments.update('asg_missing', { status: 'done' })).toThrow(/not found/)
    })
  })

  describe('nudges', () => {
    it('adds pending nudges, updates them and finds them by dedupe key', () => {
      const { repos, clock } = t()
      const n = repos.nudges.add({
        kind: 'review_due',
        title: 'Review',
        body: '3 due',
        action: { type: 'start_review', conceptIds: ['con_1'] },
        dedupeKey: 'review:2026-10-24',
      })
      expect(n).toMatchObject({ shownAt: null, outcome: 'pending', createdAt: clock.nowIso() })
      expect(n.id).toMatch(/^ndg_/)
      const shown = repos.nudges.update(n.id, { shownAt: clock.nowIso(), outcome: 'accepted' })
      expect(shown).toEqual({ ...n, shownAt: clock.nowIso(), outcome: 'accepted' })
      clock.advance(60_000)
      const m = repos.nudges.add({
        kind: 'tip',
        title: 'Tip',
        body: 'b',
        action: null,
        dedupeKey: 'tip',
      })
      expect(repos.nudges.listSince(n.createdAt).map((x) => x.id)).toEqual([n.id, m.id])
      expect(repos.nudges.listSince(m.createdAt).map((x) => x.id)).toEqual([m.id])
      expect(repos.nudges.findByDedupeKey('review:2026-10-24', n.createdAt)?.id).toBe(n.id)
      expect(repos.nudges.findByDedupeKey('review:2026-10-24', m.createdAt)).toBeNull()
      expect(repos.nudges.findByDedupeKey('nope', n.createdAt)).toBeNull()
      expect(() => repos.nudges.update('ndg_missing', { outcome: 'expired' })).toThrow(/not found/)
    })
  })

  describe('chat', () => {
    it('appends messages and returns the last N of a thread in order', () => {
      const { repos, clock } = t()
      const say = (thread: string, content: string) => {
        clock.advance(1000)
        return repos.chat.append({ thread, role: 'user', content, actions: [] })
      }
      const m1 = say('coach', 'one')
      say('other', 'x')
      const m2 = say('coach', 'two')
      const m3 = repos.chat.append({
        thread: 'coach',
        role: 'assistant',
        content: 'three',
        actions: [{ type: 'open_subject', subjectId: 'sub_1' }],
      })
      expect(m1).toMatchObject({
        id: expect.stringMatching(/^msg_/),
        createdAt: expect.any(String),
      })
      expect(repos.chat.history('coach', 10)).toEqual([m1, m2, m3])
      expect(repos.chat.history('coach', 2)).toEqual([m2, m3])
      expect(repos.chat.history('none', 5)).toEqual([])
    })
  })

  describe('profile, settings and usage', () => {
    it('starts with an empty profile and merges updates', () => {
      const { repos, clock } = t()
      expect(repos.profile.get()).toEqual({
        aboutMe: '',
        level: null,
        promptLanguage: 'auto',
        habits: {
          promptsSeen: 0,
          withContext: 0,
          withStructure: 0,
          askedToBeQuizzed: 0,
          askedForExamples: 0,
        },
        summary: '',
        updatedAt: clock.nowIso(),
      })
      clock.advance(1000)
      const p = repos.profile.update({ aboutMe: 'Chem student', level: 'undergrad' })
      expect(p).toMatchObject({
        aboutMe: 'Chem student',
        level: 'undergrad',
        promptLanguage: 'auto',
        updatedAt: clock.nowIso(),
      })
      expect(repos.profile.get()).toEqual(p)
    })

    it('starts from DEFAULT_SETTINGS and shallow-merges patches', () => {
      const { repos } = t()
      expect(repos.settings.get()).toEqual(DEFAULT_SETTINGS)
      const s = repos.settings.update({
        captureEnabled: false,
        privacy: { episodeRetentionHours: 24, redact: false },
      })
      expect(s).toEqual({
        ...DEFAULT_SETTINGS,
        captureEnabled: false,
        privacy: { episodeRetentionHours: 24, redact: false },
      })
      s.orb.visible = false
      expect(repos.settings.get().orb.visible).toBe(true)
      expect(repos.settings.get()).toEqual({ ...s, orb: DEFAULT_SETTINGS.orb })
    })

    it('aggregates LLM usage per provider and model', () => {
      const { repos } = t()
      repos.usage.record(llmCall({ at: '2026-10-23T23:00:00.000Z' }))
      repos.usage.record(llmCall())
      repos.usage.record(
        llmCall({ provider: 'apple', model: 'system', tokensIn: 10, tokensOut: 5 }),
      )
      repos.usage.record(llmCall({ ok: false, error: '429', tokensIn: 0, tokensOut: 0 }))
      const since = '2026-10-24T00:00:00.000Z'
      expect(repos.usage.rowsSince(since)).toEqual([
        {
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          calls: 2,
          failures: 1,
          tokensIn: 100,
          tokensOut: 50,
        },
        { provider: 'apple', model: 'system', calls: 1, failures: 0, tokensIn: 10, tokensOut: 5 },
      ])
      expect(repos.usage.countSince('groq', 'openai/gpt-oss-20b', since)).toEqual({
        requests: 2,
        tokens: 150,
      })
      expect(repos.usage.countSince('ovh', 'gpt-oss-20b', since)).toEqual({
        requests: 0,
        tokens: 0,
      })
    })
  })
}
