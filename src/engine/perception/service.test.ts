import type { Episode } from '@shared/domain'
import type { NowContext } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import type { AiChatInfo, Repos } from '../contracts'
import { createEngineBus, type EngineBus } from '../events'
import { FakeBrain } from '../testing/fake-brain'
import { createMemoryRepos } from '../testing/memory-repos'
import { Perception } from './service'
import { createPerceptionStack } from './stack'
import { makeEpisode } from './testing/episodes'
import { prose } from './testing/frames'
import { runFor, ScriptedHelper, type ScriptedWindow } from './testing/scripted-helper'

const chatgpt: ScriptedWindow = {
  pid: 11,
  bundleId: 'com.openai.chat',
  appName: 'ChatGPT',
  windowId: 2,
  title: 'ChatGPT',
  url: null,
  lines: [
    { text: 'what is osmosis', align: 'right' },
    { text: 'Osmosis is the diffusion of water across a semipermeable membrane.', align: 'left' },
    { text: 'Ask anything', align: 'left' },
  ],
}
const wiki: ScriptedWindow = {
  pid: 10,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 1,
  title: 'Osmosis - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Osmosis',
  lines: prose('Osmosis', 1, 12),
}
const onePassword: ScriptedWindow = {
  pid: 12,
  bundleId: 'com.1password.1password',
  appName: '1Password',
  windowId: 3,
  title: 'Personal vault',
  url: null,
  lines: ['github.com', 'password ********'],
}

describe('Perception', () => {
  let clock: FakeClock
  let helper: ScriptedHelper
  let repos: Repos
  let bus: EngineBus
  let perception: Perception
  let chats: (AiChatInfo | null)[]
  let closed: Episode[]
  let nows: (NowContext | null)[]

  beforeEach(() => {
    clock = new FakeClock('2026-10-24T09:00:00.000Z')
    helper = new ScriptedHelper(clock)
    repos = createMemoryRepos(clock)
    bus = createEngineBus()
    chats = []
    closed = []
    nows = []
    bus.on('perception:aiChat', ({ chat }) => chats.push(chat))
    bus.on('perception:episodeClosed', ({ episode }) => closed.push(episode))
    bus.on('perception:now', ({ now }) => nows.push(now))
    perception = new Perception({ helper, repos, bus, clock })
  })

  it('detects an AI chat within one tick and serves its excerpt', async () => {
    helper.front = chatgpt
    perception.start()
    await runFor(clock, 300)
    expect(chats).toHaveLength(1)
    expect(perception.aiChat()).toMatchObject({ key: 'chatgpt', assistant: 'ChatGPT', pid: 11 })
    expect(perception.chatExcerpt(1000)).toBe(
      'Student: what is osmosis\n\nChatGPT: Osmosis is the diffusion of water across a semipermeable membrane.',
    )
    expect(perception.isActive()).toBe(true)
    expect(perception.now()).toMatchObject({ app: 'ChatGPT', kind: 'ai_chat' })
  })

  it('saves closed episodes and keeps the page context', async () => {
    helper.front = wiki
    perception.start()
    await runFor(clock, 30_000)
    helper.front = chatgpt
    await runFor(clock, 10_000)
    expect(closed).toHaveLength(1)
    expect(repos.episodes.get(closed[0]?.id ?? '')?.url).toBe(wiki.url)
    expect(perception.pageContext(300)).toContain('Osmosis sentence 1 explains')
    expect(perception.aiChat()?.key).toBe('chatgpt')
  })

  it('never reads blocked apps and clears "Right now" for them', async () => {
    helper.front = wiki
    perception.start()
    await runFor(clock, 2500)
    helper.front = onePassword
    await runFor(clock, 12_000)
    expect(helper.served.some((w) => w.bundleId === onePassword.bundleId)).toBe(false)
    expect(perception.now()).toBeNull()
    expect(closed.every((e) => e.bundleId !== onePassword.bundleId)).toBe(true)
  })

  it('stores a highlight right away and closes the page ~10 s after the last one', async () => {
    const noted: string[] = []
    bus.on('perception:highlight', ({ text }) => noted.push(text))
    helper.front = wiki
    perception.start()
    await runFor(clock, 3000)
    const start = clock.now()
    helper.selection = 'Osmosis sentence 2'
    await runFor(clock, 1000)
    expect(noted).toEqual(['Osmosis sentence 2'])
    expect(clock.now() - start).toBeLessThanOrEqual(1000)
    helper.selection = null
    await runFor(clock, 4000)
    helper.selection = 'Osmosis sentence 3'
    await runFor(clock, 1000)
    expect(noted).toHaveLength(2)
    await runFor(clock, 8500)
    expect(closed).toHaveLength(0) // debounced: 10 s after the *last* highlight
    await runFor(clock, 2000)
    expect(closed).toHaveLength(1)
    expect(closed[0]?.signals.highlights).toEqual(['Osmosis sentence 2', 'Osmosis sentence 3'])
    expect(closed[0]?.extracted).toBe(false)
    expect(repos.episodes.get(closed[0]?.id ?? '')?.signals.highlights).toHaveLength(2)
  })

  it('ignores selections in text fields and in blocked apps', async () => {
    const noted: string[] = []
    bus.on('perception:highlight', ({ text }) => noted.push(text))
    helper.front = wiki
    perception.start()
    await runFor(clock, 2000)
    const field = { pid: 10, bundleId: wiki.bundleId, appName: wiki.appName, role: 'AXTextField' }
    bus.emit('helper:focus', {
      app: null,
      element: {
        ...field,
        subrole: null,
        editable: true,
        isSecure: false,
        frame: null,
        caret: null,
        placeholder: null,
        valueLength: 5,
        ref: null,
      },
    })
    helper.selection = 'typed text'
    await runFor(clock, 2000)
    expect(noted).toEqual([])
    bus.emit('helper:focus', { app: null, element: null })
    helper.selection = null
    helper.front = onePassword
    await runFor(clock, 2000)
    helper.selection = 'github.com'
    await runFor(clock, 2000)
    expect(noted).toEqual([])
  })

  it('seeds stored lines from saved episodes: a revisit with nothing new needs no LLM call', async () => {
    repos.episodes.save(
      makeEpisode({
        bundleId: wiki.bundleId,
        app: wiki.appName,
        url: wiki.url,
        title: wiki.title,
        startedAt: '2026-10-24T08:00:00.000Z',
        endedAt: '2026-10-24T08:05:00.000Z',
        text: (wiki.lines as string[]).join('\n'),
      }),
    )
    helper.front = wiki
    perception.start()
    await runFor(clock, 30_000)
    helper.front = chatgpt
    await runFor(clock, 10_000)
    expect(closed).toHaveLength(1)
    expect(closed[0]?.extracted).toBe(true)
    expect(closed[0]?.text.split('\n').length).toBeLessThanOrEqual(3)
  })

  it('stops immediately when switched off, closing what was open', async () => {
    helper.front = wiki
    perception.start()
    await runFor(clock, 20_000)
    const calls = helper.calls.length
    perception.setEnabled(false)
    expect(perception.isActive()).toBe(false)
    expect(closed).toHaveLength(1)
    await runFor(clock, 20_000)
    expect(helper.calls.length).toBe(calls)
    perception.setEnabled(true)
    await runFor(clock, 1000)
    expect(helper.calls.length).toBeGreaterThan(calls)
  })

  it('follows settings changes and screen locks from the bus', async () => {
    helper.front = chatgpt
    perception.start()
    await runFor(clock, 300)
    bus.emit('helper:screenLocked', { locked: true })
    expect(perception.aiChat()).toBeNull()
    expect(perception.isActive()).toBe(false)
    bus.emit('helper:screenLocked', { locked: false })
    await runFor(clock, 500)
    expect(perception.aiChat()?.key).toBe('chatgpt')
    const settings = repos.settings.update({ captureEnabled: false })
    bus.emit('settings:changed', { settings })
    const calls = helper.calls.length
    await runFor(clock, 10_000)
    expect(helper.calls.length).toBe(calls)
  })

  it('links extracted subjects into "Right now"', async () => {
    helper.front = wiki
    perception.start()
    await runFor(clock, 400_000) // long enough for a 3-minute checkpoint
    const first = closed[0] as Episode
    perception.linkSubject(first.id, 'sub_bio')
    await runFor(clock, 2000)
    expect(perception.now()?.subjectId).toBe('sub_bio')
    expect(nows.at(-1)?.minutes).toBeGreaterThanOrEqual(6)
  })

  it('checkpoints the open chat on demand', async () => {
    helper.front = chatgpt
    perception.start()
    await runFor(clock, 20_000)
    expect(perception.checkpointChat()).toBe(true)
    expect(closed).toHaveLength(1)
    expect(closed[0]?.kind).toBe('ai_chat')
    expect(perception.chatExcerpt(1000)).toContain('what is osmosis')
  })

  it("seeds today's visits from stored episodes", async () => {
    repos.episodes.save(
      makeEpisode({
        url: wiki.url,
        startedAt: '2026-10-24T08:00:00.000Z',
        endedAt: '2026-10-24T08:03:00.000Z',
      }),
    )
    repos.episodes.save(
      makeEpisode({
        url: wiki.url,
        startedAt: '2026-10-24T08:03:00.000Z',
        endedAt: '2026-10-24T08:05:00.000Z',
      }),
    )
    helper.front = wiki
    perception.start()
    await runFor(clock, 30_000)
    perception.stop()
    expect(closed[0]?.signals.revisitsToday).toBe(1)
  })
})

describe('createPerceptionStack', () => {
  it('runs screen → episode → extraction → memory and feeds the subject back', async () => {
    const clock = new FakeClock('2026-10-24T09:00:00.000Z')
    const helper = new ScriptedHelper(clock)
    const repos = createMemoryRepos(clock)
    const bus = createEngineBus()
    const brain = new FakeBrain()
    const stack = createPerceptionStack({ helper, repos, bus, clock, brain })
    helper.front = wiki
    stack.start()
    await runFor(clock, 60_000)
    helper.front = {
      ...wiki,
      windowId: 9,
      title: 'Other',
      url: 'https://example.org/x',
      lines: ['x'],
    }
    await runFor(clock, 12_000)
    await stack.worker.flushNow()
    expect(repos.encounters.list({})).toHaveLength(1)
    expect(repos.subjects.list()[0]?.status).toBe('suggested')
    stack.stop()
  })
})
