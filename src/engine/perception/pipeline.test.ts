/**
 * End-to-end perception pipeline over the recorded fixtures (tests/fixtures/episodes): scripted
 * screen → capture scheduler + privacy gate → episode builder → prefilter → Brain.extract (a
 * FakeBrain answering from each fixture's ground truth and the signals perception sent) →
 * encounters, concepts, assignments and prompt habits in createMemoryRepos. Blocked windows must
 * leave no trace anywhere: not in helper replies, bus events, the LLM input or the database.
 */
import type { Episode } from '@shared/domain'
import { beforeAll, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import type { Repos } from '../contracts'
import { createEngineBus } from '../events'
import { FakeBrain } from '../testing/fake-brain'
import { createMemoryRepos } from '../testing/memory-repos'
import { WORKER_DEFAULTS } from './extraction/worker'
import { createPerceptionStack } from './stack'
import {
  type EpisodeFixture,
  fixtureExtractor,
  loadEpisodeFixtures,
  replayFixture,
} from './testing/fixtures'
import { runFor, ScriptedHelper } from './testing/scripted-helper'

interface Run {
  closed: Episode[]
  chats: (string | null)[]
  memoryScopes: string[]
  /** Every perception event payload, for the privacy check. */
  events: unknown[]
  brain: FakeBrain
  repos: Repos
  helper: ScriptedHelper
}

async function play(fx: EpisodeFixture): Promise<Run> {
  const clock = new FakeClock(fx.start)
  const helper = new ScriptedHelper(clock)
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const brain = new FakeBrain({ extract: fixtureExtractor(fx) })
  const run: Run = { closed: [], chats: [], memoryScopes: [], events: [], brain, repos, helper }
  bus.on('perception:episodeClosed', (e) => {
    run.closed.push(e.episode)
    run.events.push(e)
  })
  bus.on('perception:aiChat', (e) => {
    run.chats.push(e.chat?.key ?? null)
    run.events.push(e)
  })
  bus.on('perception:window', (e) => run.events.push(e))
  bus.on('perception:now', (e) => run.events.push(e))
  bus.on('memory:changed', (e) => run.memoryScopes.push(e.scope))

  const stack = createPerceptionStack({ helper, repos, bus, clock, brain })
  stack.start()
  await replayFixture(fx, helper, clock)
  await runFor(clock, WORKER_DEFAULTS.flushEveryMs) // the worker's periodic flush
  await stack.worker.flushNow()
  stack.stop()
  return run
}

const extractCalls = (r: Run) => r.brain.calls.filter((c) => c.method === 'extract').length
const longest = (r: Run) => [...r.closed].sort((a, b) => b.dwellSeconds - a.dwellSeconds)[0]

const fixtures = loadEpisodeFixtures()

describe('perception pipeline on recorded fixtures', () => {
  it('covers the recorded scenarios', () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      'wikipedia-scrollback',
      'scanned-pdf-preview',
      'chatgpt-conversation',
      'moodle-assignment',
      'spotify-and-news',
      'password-manager',
      'incognito-window',
      'claude-app-code-tab',
      'claude-code-tab-real',
    ])
  })

  describe.each(fixtures.map((fx) => ({ name: fx.name, fx })))('$name', ({ fx }) => {
    const ex = fx.expect
    let r: Run
    beforeAll(async () => {
      r = await play(fx)
    })

    it('closes, stores and finishes every episode', () => {
      if (ex.episodes !== undefined) expect(r.closed).toHaveLength(ex.episodes)
      const stored = r.repos.episodes.recent({ sinceIso: fx.start })
      expect(stored.map((e) => e.id).sort()).toEqual(r.closed.map((e) => e.id).sort())
      expect(r.repos.episodes.listUnextracted(100)).toEqual([]) // prefiltered out or extracted
    })

    const main = ex.main
    if (main) {
      it('reads the main episode the way the student experienced it', () => {
        const ep = longest(r)
        if (!ep) throw new Error('no episode')
        if (main.kind) expect(ep.kind).toBe(main.kind)
        if (main.source) expect(ep.source).toBe(main.source)
        if (main.aiProvider !== undefined) expect(ep.aiProvider).toBe(main.aiProvider)
        if (main.minDwell !== undefined)
          expect(ep.dwellSeconds).toBeGreaterThanOrEqual(main.minDwell)
        if (main.scrollBacks !== undefined) expect(ep.signals.scrollBacks).toBe(main.scrollBacks)
        if (main.searches) expect(ep.signals.searches).toEqual(main.searches)
        if (main.aiQuestions) expect(ep.signals.aiQuestions).toEqual(main.aiQuestions)
        let from = 0
        for (const snippet of main.textIncludes) {
          const at = ep.text.indexOf(snippet, from)
          expect(at, `"${snippet}" in order`).toBeGreaterThanOrEqual(0)
          from = at + snippet.length
        }
        for (const snippet of main.textExcludes) expect(ep.text).not.toContain(snippet)
      })
    }

    const learns = fx.learning && ex.encounters > 0
    it(learns ? 'turns what was learned into memory' : 'keeps nothing about it', () => {
      if (ex.extractCalls !== undefined) expect(extractCalls(r)).toBe(ex.extractCalls)
      const encounters = r.repos.encounters.list({})
      expect(encounters).toHaveLength(ex.encounters)
      if (ex.understanding) {
        expect(encounters.map((e) => e.understanding)).toEqual(
          encounters.map(() => ex.understanding),
        )
      }
      const subject = ex.subject ? r.repos.subjects.findByName(ex.subject) : null
      if (ex.subject) {
        if (!subject) throw new Error(`subject ${ex.subject} missing`)
        expect(encounters.every((e) => e.subjectId === subject.id)).toBe(true)
        const concepts = r.repos.concepts.listBySubject(subject.id).map((c) => c.name)
        expect(concepts.sort()).toEqual([...ex.concepts].sort())
        expect(r.memoryScopes).toEqual(expect.arrayContaining(['inbox', 'subjects', 'concepts']))
      } else {
        expect(r.repos.subjects.list()).toEqual([])
        expect(r.memoryScopes).toEqual([])
      }
      const assignments = r.repos.assignments.list({})
      if (ex.assignment) expect(assignments).toEqual([expect.objectContaining(ex.assignment)])
      else expect(assignments).toEqual([])
      if (ex.promptsSeen !== undefined) {
        expect(r.repos.profile.get().habits.promptsSeen).toBe(ex.promptsSeen)
      }
    })

    const aiChat = ex.aiChat
    if (aiChat !== undefined) {
      it('reports the AI chat while it is open', () => {
        if (aiChat === null) {
          expect(r.chats.filter(Boolean)).toEqual([]) // never reported as a chat
          return
        }
        expect(r.chats).toContain(aiChat)
        expect(r.chats.at(-1)).toBeNull() // cleared when the chat closed
      })
    }

    if (ex.blocked) {
      it('never reads, shows, stores or sends the blocked window', () => {
        expect(r.helper.served).toEqual([])
        expect(r.helper.callsOf('perceive').filter((c) => isFrontScope(c.params))).toEqual([])
        const secrets = [
          ...Object.values(fx.windows).flatMap((w) => [w.title, w.url]),
          ...fx.timeline
            .flatMap((s) => s.lines ?? [])
            .map((l) => (typeof l === 'string' ? l : l.text)),
        ].filter((s): s is string => typeof s === 'string' && s.length > 0)
        const trace = JSON.stringify([
          r.events,
          r.brain.calls,
          r.repos.episodes.recent({ sinceIso: fx.start }),
        ])
        for (const secret of secrets) expect(trace).not.toContain(secret)
      })
    }
  })
})

function isFrontScope(params: unknown): boolean {
  return (params as { scope?: string } | null)?.scope === 'frontmost'
}
