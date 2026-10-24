/**
 * Unknown AI chats recognised from the composer the student focuses: the tracker's focus hint
 * and the 'helper:focus' wiring of the PerceptionService.
 */
import type { FocusedElement } from '@shared/helper-protocol'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import type { AiChatInfo } from '../../contracts'
import { createEngineBus } from '../../events'
import { createMemoryRepos } from '../../testing/memory-repos'
import { Perception } from '../service'
import { win } from '../testing/frames'
import { runFor, ScriptedHelper, type ScriptedWindow } from '../testing/scripted-helper'
import { AiChatTracker } from './tracker'

const SCREEN = [
  'New Chat',
  'llama3.2:latest',
  ['explain osmosis like I am 12', 'right'],
  ['Osmosis is water moving through a membrane toward the saltier side.', 'left'],
  'LLMs can make mistakes. Verify important information.',
] as const

const webui = (url = 'http://localhost:3000/c/1', withLines = true) =>
  win({
    pid: 10,
    title: 'Open WebUI',
    url,
    lines: withLines ? SCREEN.map((l) => (typeof l === 'string' ? l : [l[0], l[1]])) : [],
  })

const composer = (over: Partial<FocusedElement> = {}): FocusedElement => ({
  pid: 10,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  role: 'AXTextArea',
  subrole: null,
  editable: true,
  isSecure: false,
  frame: { x: 300, y: 700, width: 720, height: 48 },
  caret: null,
  placeholder: 'How can I help you today?',
  valueLength: 0,
  ref: 'r1',
  ...over,
})

describe('AiChatTracker focus hints', () => {
  it('recognises an unknown chat once its composer is focused, and keeps it while typing', () => {
    const seen: (AiChatInfo | null)[] = []
    const tracker = new AiChatTracker((c) => seen.push(c))
    tracker.observeFrontmost(webui())
    expect(tracker.get()).toBeNull()
    tracker.observeFocus(composer())
    expect(tracker.get()).toMatchObject({ key: 'ai_chat', assistant: 'AI chat', pid: 10 })
    tracker.observeFrontmost(webui('http://localhost:3000/c/1', false)) // unchanged frame
    tracker.observeFocus(composer({ placeholder: null, valueLength: 12 })) // typing
    tracker.observeFrontmost(webui('http://localhost:3000/c/2')) // the next conversation
    expect(tracker.get()?.key).toBe('ai_chat')
    tracker.observeFrontmost(win({ pid: 10, url: 'https://en.wikipedia.org/wiki/Osmosis' }))
    expect(tracker.get()).toBeNull()
    expect(seen.map((c) => c?.url ?? null)).toEqual([
      'http://localhost:3000/c/1',
      'http://localhost:3000/c/2',
      null,
    ])
  })

  it('ignores focus in another app, non-composers and password fields', () => {
    const tracker = new AiChatTracker()
    tracker.observeFrontmost(webui())
    tracker.observeFocus(composer({ pid: 99 }))
    tracker.observeFocus(composer({ role: 'AXButton', editable: false }))
    tracker.observeFocus(composer({ isSecure: true }))
    tracker.observeFocus(composer({ role: 'AXTextField', subrole: 'AXSearchField' }))
    tracker.observeFocus(null)
    expect(tracker.get()).toBeNull()
  })

  it('forgets the composer when capture resets', () => {
    const tracker = new AiChatTracker()
    tracker.observeFrontmost(webui())
    tracker.observeFocus(composer())
    tracker.reset()
    tracker.observeFrontmost(webui('http://localhost:3000/c/9'))
    expect(tracker.get()).toBeNull()
  })
})

describe('Perception + helper:focus', () => {
  it('reports an unknown chat as "AI chat" for docking, the picker and the excerpt', async () => {
    const clock = new FakeClock('2026-10-24T09:00:00.000Z')
    const helper = new ScriptedHelper(clock)
    const bus = createEngineBus()
    const chats: (AiChatInfo | null)[] = []
    bus.on('perception:aiChat', ({ chat }) => chats.push(chat))
    const perception = new Perception({ helper, repos: createMemoryRepos(clock), bus, clock })
    const front = webui() as ScriptedWindow
    helper.front = front
    perception.start()
    await runFor(clock, 300)
    expect(perception.aiChat()).toBeNull()
    bus.emit('helper:focus', { app: null, element: composer() })
    expect(perception.aiChat()).toMatchObject({ key: 'ai_chat', assistant: 'AI chat', pid: 10 })
    await runFor(clock, 4000)
    expect(perception.aiChat()?.key).toBe('ai_chat')
    expect(perception.chatExcerpt(1000)).toContain('Osmosis is water moving through a membrane')
    perception.stop()
    expect(chats.map((c) => c?.key ?? null)).toEqual(['ai_chat', null])
  })
})
