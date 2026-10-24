import type { Episode } from '@shared/domain'
import type { MemoryChanged, SessionState } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ExtractInput, TriageInput } from '../../brain-contract'
import { FakeClock } from '../../clock'
import type { Repos } from '../../contracts'
import { createEngineBus, type EngineBus } from '../../events'
import { FakeBrain } from '../../testing/fake-brain'
import { createMemoryRepos } from '../../testing/memory-repos'
import { makeEpisode, STUDY_TEXT } from '../testing/episodes'
import { flushAsync } from '../testing/scripted-helper'
import { conceptTree, ExtractionWorker, type WorkerOptions } from './worker'

const session = (phase: SessionState['phase']): SessionState => ({
  roadmapId: 'rdm_1',
  subjectId: 'sub_1',
  subjectName: 'Chemistry',
  subjectEmoji: '🧪',
  title: 'SN1',
  phase,
  index: 0,
  total: 4,
  items: [],
  nextAction: 'paste_next',
  assistant: 'ChatGPT',
  startReason: '',
  offerPlacement: false,
  error: null,
})

describe('ExtractionWorker', () => {
  let clock: FakeClock
  let repos: Repos
  let bus: EngineBus
  let brain: FakeBrain
  let changes: MemoryChanged[]
  let linked: [string, string][]

  const make = (options: Partial<WorkerOptions> = {}) =>
    new ExtractionWorker({
      repos,
      brain,
      bus,
      clock,
      options,
      onEpisodeSubject: (e, s) => linked.push([e, s]),
    })
  const extractCalls = () =>
    brain.calls.filter((c) => c.method === 'extract').map((c) => c.input as ExtractInput)
  const triageCalls = () =>
    brain.calls.filter((c) => c.method === 'triage').map((c) => c.input as TriageInput)
  const saved = (overrides: Partial<Episode> = {}) => {
    const ep = makeEpisode({ endedAt: clock.nowIso(), ...overrides })
    repos.episodes.save(ep)
    return ep
  }

  beforeEach(() => {
    clock = new FakeClock('2026-10-24T09:00:00.000Z')
    repos = createMemoryRepos(clock)
    bus = createEngineBus()
    brain = new FakeBrain()
    changes = []
    linked = []
    bus.on('memory:changed', (c) => changes.push(c))
  })

  it('marks episodes that fail the prefilter as done without calling the LLM', async () => {
    const worker = make()
    const ep = saved({ dwellSeconds: 5 })
    expect(worker.enqueue(ep).pass).toBe(false)
    await worker.flushNow()
    expect(extractCalls()).toHaveLength(0)
    expect(repos.episodes.get(ep.id)?.extracted).toBe(true)
  })

  it('batches at most 3 episodes per call and writes memory', async () => {
    const worker = make()
    const eps = Array.from({ length: 5 }, () => saved())
    for (const ep of eps) worker.enqueue(ep)
    expect(worker.pending).toBe(5)
    await worker.flushNow()
    expect(extractCalls().map((c) => c.episodes.length)).toEqual([3, 2])
    expect(worker.pending).toBe(0)
    expect(eps.every((e) => repos.episodes.get(e.id)?.extracted)).toBe(true)
    expect(repos.encounters.list({})).toHaveLength(5)
    expect(changes.map((c) => c.scope)).toContain('inbox')
    expect(changes.map((c) => c.scope)).toContain('subjects')
    // The first read stays loose; the topic coming back makes the suggested subject.
    expect(linked).toHaveLength(4)
  })

  it('respects the token cap per batch', async () => {
    const worker = make({ maxBatchTokens: 1500, maxEpisodeChars: 4000 })
    const long = `${STUDY_TEXT}\n`.repeat(10)
    for (let i = 0; i < 3; i++) worker.enqueue(saved({ text: long }))
    await worker.flushNow()
    expect(extractCalls().map((c) => c.episodes.length)).toEqual([1, 1, 1])
  })

  it('judges a window on its own once it is 5 minutes old', async () => {
    const worker = make()
    worker.start()
    bus.emit('perception:episodeClosed', { episode: saved() })
    await flushAsync()
    clock.advance(4 * 60 * 1000)
    bus.emit('perception:episodeClosed', { episode: saved({ title: 'SN2 – Wikipedia' }) })
    await flushAsync()
    expect(triageCalls()).toHaveLength(0)
    expect(extractCalls()).toHaveLength(0)
    clock.advance(60 * 1000)
    await flushAsync()
    // One triage call for the whole window, then the "yes" episodes together.
    expect(triageCalls().map((c) => c.episodes.length)).toEqual([2])
    expect(extractCalls().map((c) => c.episodes.length)).toEqual([2])
    worker.stop()
  })

  it('extracts AI-chat episodes at once during a study session', async () => {
    const worker = make()
    worker.start()
    const chat = () =>
      saved({
        kind: 'ai_chat',
        aiProvider: 'chatgpt',
        url: 'https://chatgpt.com/c/1',
        title: 'ChatGPT',
        text: `[R] why?\n[L] ${STUDY_TEXT}`,
      })
    bus.emit('perception:episodeClosed', { episode: chat() })
    await flushAsync()
    expect(extractCalls()).toHaveLength(0) // no session: waits for the 5-minute window
    bus.emit('session:changed', { session: session('step') })
    await flushAsync()
    expect(extractCalls()).toHaveLength(1) // queued chat flushed when the session started
    bus.emit('perception:episodeClosed', { episode: chat() })
    await flushAsync()
    expect(extractCalls()).toHaveLength(2)
    worker.stop()
  })

  it('stops at the daily budget and resumes the next day', async () => {
    // Triage counts: one window is a triage call plus an extraction call.
    const worker = make({ dailyMaxCalls: 2 })
    worker.enqueue(saved())
    await worker.flushNow()
    worker.enqueue(saved({ url: 'https://en.wikipedia.org/wiki/SN2_reaction' }))
    await worker.flushNow()
    expect(triageCalls()).toHaveLength(1)
    expect(extractCalls()).toHaveLength(1)
    expect(worker.pending).toBe(1)
    expect(worker.budgetLeft().calls).toBe(0)
    clock.advance(24 * 60 * 60 * 1000)
    await worker.flushNow()
    expect(extractCalls()).toHaveLength(2)
  })

  describe('batched decision', () => {
    // Long enough for the pre-gate, but with no study vocabulary: the old score says no.
    const PLAIN = 'We went to the lake on Saturday and the weather was fine. '.repeat(5)

    it('sends only the "yes" episodes to P1 and closes the "no" ones without a call', async () => {
      brain = new FakeBrain({
        triage: async (input) => ({
          results: input.episodes.map((e, i) => ({
            id: e.id,
            hasLearnableContent: i === 0,
            reason: i === 0 ? 'history facts' : 'no content',
          })),
        }),
      })
      const worker = make()
      const yes = saved({ title: 'Tampere – Wikipedia' })
      const no = saved({ title: 'Lake trip' })
      worker.enqueue(yes)
      worker.enqueue(no)
      await worker.flushNow()
      expect(extractCalls().map((c) => c.episodes.map((e) => e.id))).toEqual([[yes.id]])
      expect(repos.episodes.get(no.id)?.extracted).toBe(true)
      expect(repos.episodes.get(yes.id)?.extracted).toBe(true)
    })

    it("gives P1 the window's other episodes as context", async () => {
      brain = new FakeBrain({
        triage: async (input) => ({
          results: input.episodes.map((e) => ({
            id: e.id,
            hasLearnableContent: e.title !== 'tampere history - Google Search',
            reason: '',
          })),
        }),
      })
      const worker = make()
      worker.enqueue(saved({ title: 'tampere history - Google Search' }))
      worker.enqueue(saved({ title: 'Tampere – Wikipedia' }))
      worker.enqueue(
        saved({
          kind: 'ai_chat',
          title: 'ChatGPT',
          text: `[R] who was Finlayson\n[L] ${STUDY_TEXT}`,
        }),
      )
      await worker.flushNow()
      const [call] = extractCalls()
      expect(call?.episodes).toHaveLength(2)
      expect(call?.context).toEqual(['tampere history - Google Search (reading)'])
    })

    it('falls back to the prefilter score when triage fails or gives no answer', async () => {
      brain = new FakeBrain({
        triage: async () => {
          throw new Error('provider down')
        },
      })
      const worker = make()
      const study = saved()
      const plain = saved({ text: PLAIN, title: 'Lake trip', url: 'https://someblog.example/lake' })
      expect(worker.enqueue(plain)).toMatchObject({ gate: true, pass: false })
      worker.enqueue(study)
      await worker.flushNow()
      expect(extractCalls().map((c) => c.episodes.map((e) => e.id))).toEqual([[study.id]])
      expect(repos.episodes.get(plain.id)?.extracted).toBe(true)

      brain = new FakeBrain({ triage: async () => ({ results: [] }) })
      const again = make()
      const next = saved()
      again.enqueue(next)
      await again.flushNow()
      expect(extractCalls()).toHaveLength(1)
    })

    it('skips triage for highlights and judges their window at once', async () => {
      const worker = make()
      worker.start()
      const plain = saved({ text: PLAIN, title: 'Lake trip', url: 'https://someblog.example/lake' })
      bus.emit('perception:episodeClosed', { episode: plain })
      const marked = saved({
        signals: { ...makeEpisode().signals, highlights: ['Finlayson founded a cotton mill'] },
      })
      bus.emit('perception:episodeClosed', { episode: marked })
      await flushAsync()
      expect(triageCalls().map((c) => c.episodes.map((e) => e.id))).toEqual([[plain.id]])
      expect(extractCalls().flatMap((c) => c.episodes.map((e) => e.id))).toContain(marked.id)
      worker.stop()
    })

    it('a highlight in an explanation always counts; in a coding-agent chat app triage judges', async () => {
      brain = new FakeBrain({
        triage: async (input) => ({
          results: input.episodes.map((e) => ({
            id: e.id,
            hasLearnableContent: false,
            reason: 'build work',
          })),
        }),
      })
      const worker = make()
      const highlights = ['Alkyl groups stabilise the positive charge']
      const chatgpt = saved({
        kind: 'ai_chat',
        aiProvider: 'chatgpt',
        bundleId: 'com.google.Chrome',
        url: 'https://chatgpt.com/c/42',
        title: 'ChatGPT',
        text: `[R] why is tertiary faster\n[L] ${STUDY_TEXT}`,
        signals: { ...makeEpisode().signals, highlights },
      })
      const claudeApp = saved({
        kind: 'ai_chat',
        aiProvider: 'claude',
        app: 'Claude',
        bundleId: 'com.anthropic.claudefordesktop',
        url: null,
        title: 'Claude',
        text: `[R] let's make it so that the button deploys\n[L] ${STUDY_TEXT}`,
        signals: { ...makeEpisode().signals, highlights: ["let's make it so that"] },
      })
      worker.enqueue(chatgpt)
      worker.enqueue(claudeApp)
      await worker.flushNow()
      expect(triageCalls().map((c) => c.episodes.map((e) => e.id))).toEqual([[claudeApp.id]])
      expect(extractCalls().flatMap((c) => c.episodes.map((e) => e.id))).toEqual([chatgpt.id])
      expect(repos.episodes.get(claudeApp.id)?.extracted).toBe(true)
      expect(repos.notes.list({ status: null }).map((n) => n.text)).not.toContain(
        "let's make it so that",
      )
    })

    it('keeps obvious noise and hard-rule failures out of triage', async () => {
      const worker = make()
      const feed = saved({
        url: 'https://www.instagram.com/',
        title: 'Instagram',
        text: PLAIN,
      })
      expect(worker.enqueue(feed)).toMatchObject({ gate: false })
      expect(worker.enqueue(saved({ dwellSeconds: 5 }))).toMatchObject({ gate: false })
      await worker.flushNow()
      expect(triageCalls()).toHaveLength(0)
    })
  })

  it('retries failed calls a limited number of times', async () => {
    let attempts = 0
    brain = new FakeBrain({
      extract: async () => {
        attempts++
        throw new Error('provider down')
      },
    })
    const worker = make({ maxAttempts: 2 })
    const ep = saved()
    worker.enqueue(ep)
    await worker.flushNow()
    expect(worker.pending).toBe(1)
    await worker.flushNow()
    expect(attempts).toBe(2)
    expect(worker.pending).toBe(0)
    expect(repos.episodes.get(ep.id)?.extracted).toBe(false) // retried after the next start
  })

  it('re-queues episodes left unextracted by an outage on its hourly pass', async () => {
    let attempts = 0
    const ok = new FakeBrain()
    brain = new FakeBrain({
      extract: async (input, opts) => {
        attempts++
        if (attempts <= 2) throw new Error('provider down')
        return ok.extract(input, opts)
      },
    })
    const worker = make({ maxAttempts: 2, flushEveryMs: 10 * 60 * 1000 })
    worker.start()
    const ep = saved()
    worker.enqueue(ep)
    await worker.flushNow()
    await worker.flushNow()
    expect(worker.pending).toBe(0) // attempts used up, still unextracted in the DB
    expect(repos.episodes.get(ep.id)?.extracted).toBe(false)
    clock.advance(60 * 60 * 1000)
    await flushAsync()
    await worker.flushNow()
    expect(attempts).toBe(3)
    expect(repos.episodes.get(ep.id)?.extracted).toBe(true)
    worker.stop()
  })

  it('rejects malformed brain output without touching memory', async () => {
    brain = new FakeBrain({ extract: async () => ({ results: [{ episodeId: 1 }] }) as never })
    const worker = make({ maxAttempts: 1 })
    worker.enqueue(saved())
    await worker.flushNow()
    expect(repos.encounters.list({})).toHaveLength(0)
  })

  it('sends subjects with top concepts, the profile and redacted text', async () => {
    const chem = repos.subjects.create({ name: 'Organic Chemistry' })
    repos.concepts.upsert({ subjectId: chem.id, name: 'SN2' })
    repos.profile.update({ aboutMe: 'First-year chemistry student', promptLanguage: 'fi' })
    const worker = make()
    worker.enqueue(saved({ text: `${STUDY_TEXT}\nQuestions to maija@aalto.fi` }))
    await worker.flushNow()
    const input = extractCalls()[0] as ExtractInput
    expect(input.student).toEqual({ aboutMe: 'First-year chemistry student', language: 'fi' })
    const sn2 = repos.concepts.findByName(chem.id, 'SN2')
    expect(input.subjects).toEqual([
      {
        id: chem.id,
        name: 'Organic Chemistry',
        topConcepts: ['SN2'],
        concepts: [{ id: sn2?.id, name: 'SN2', parentId: null }],
      },
    ])
    expect(input.episodes[0]?.text).toContain('[email]')
    expect(input.episodes[0]?.text).not.toContain('maija@aalto.fi')
  })

  it('recovers unextracted episodes on start and purges text past retention', async () => {
    const old = makeEpisode({ endedAt: '2026-10-21T09:00:00.000Z' })
    const pending = makeEpisode({ endedAt: '2026-10-24T08:59:00.000Z' })
    repos.episodes.save(old)
    repos.episodes.save(pending)
    const worker = make()
    worker.start()
    expect(repos.episodes.get(old.id)?.text).toBe('')
    expect(repos.episodes.get(old.id)?.extracted).toBe(true) // empty → nothing to extract
    expect(worker.pending).toBe(1)
    await worker.flushNow()
    expect(repos.episodes.get(pending.id)?.extracted).toBe(true)
    clock.advance(49 * 60 * 60 * 1000)
    expect(repos.episodes.get(pending.id)?.text).toBe('')
    worker.stop()
  })
})

describe('conceptTree', () => {
  it('lists recent concepts first within the cap, always with their ancestors', () => {
    const repos = createMemoryRepos(new FakeClock())
    const s = repos.subjects.create({ name: 'Chemistry' })
    const root = repos.concepts.upsert({ subjectId: s.id, name: 'Reactions' })
    const mid = repos.concepts.upsert({
      subjectId: s.id,
      name: 'Substitution',
      parentName: 'Reactions',
    })
    const leaf = repos.concepts.upsert({ subjectId: s.id, name: 'SN1', parentName: 'Substitution' })
    const old = repos.concepts.upsert({ subjectId: s.id, name: 'Atoms' })
    repos.concepts.update(leaf.id, { lastSeenAt: '2026-10-24T10:00:00.000Z' })
    repos.concepts.update(old.id, { lastSeenAt: '2026-10-01T10:00:00.000Z' })
    const all = repos.concepts.listBySubject(s.id)
    expect(conceptTree(repos, s.id, all, 3)).toEqual([
      { id: root.id, name: 'Reactions', parentId: null },
      { id: mid.id, name: 'Substitution', parentId: root.id },
      { id: leaf.id, name: 'SN1', parentId: mid.id },
    ])
    expect(conceptTree(repos, s.id, all, 10)).toHaveLength(4)
    expect(conceptTree(repos, s.id, all, 0)).toEqual([])
  })
})
