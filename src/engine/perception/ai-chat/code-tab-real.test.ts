/**
 * The Claude desktop app's Code tab as the real helper reports it (fixture 09, captured
 * 2026-10-24): title "Claude", one long transcript line, "Ran 2 commands", the "Claude Code"
 * header, the workspace chip and the agent's checklist. It is a coding session, never a study
 * chat, and its episodes are closed as already extracted; the app's normal chat stays a chat.
 */
import type { Episode } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { EpisodeBuilder } from '../episodes/builder'
import { loadEpisodeFixtures } from '../testing/fixtures'
import { batch, type LineSpec, win } from '../testing/frames'
import { codingEvidence, looksLikeCodingSession } from './coding'
import { detectAssistant } from './detector'
import { AiChatTracker } from './tracker'

const CLAUDE = 'com.anthropic.claudefordesktop'
const fixture = loadEpisodeFixtures().find((f) => f.name === 'claude-code-tab-real')
if (!fixture) throw new Error('fixture claude-code-tab-real missing')

/** The three real Code-tab samples, as LineSpecs. */
const SAMPLES: LineSpec[][] = fixture.timeline
  .filter((s) => s.lines)
  .map((s) =>
    (s.lines ?? []).map((l): LineSpec => (typeof l === 'string' ? l : [l.text, l.align ?? null])),
  )

const text = (spec: LineSpec[]) => spec.map((l) => (typeof l === 'string' ? l : l[0]))
const claudeWin = (spec: LineSpec[]) =>
  win({
    pid: 517,
    bundleId: CLAUDE,
    appName: 'Claude',
    windowId: 252,
    title: 'Claude',
    url: null,
    lines: spec,
  })

/** The Claude app's normal chat about programming: a study chat, even next to code. */
const CLAUDE_STUDY_CHAT: LineSpec[] = [
  'New chat',
  'Chats',
  'Claude Code',
  ['How do I read a CSV file in Python?', 'right'],
  ['Install pandas, then load the file with read_csv:', 'left'],
  'pip install pandas',
  'data/load.py',
  'Reply to Claude…',
  'Opus 5.5',
]

/** Real OCR of the ChatGPT home page in Chrome (names removed): its sidebar has "Codex". */
const CHATGPT_HOME: LineSpec[] = [
  'ChatGPT',
  'New chat',
  'Images',
  'Tasks',
  'Library',
  'Plugins',
  'Codex',
  'Explore',
  'Projects',
  'Recents',
  ["What's on your mind today?", 'right'],
  '+ Ask ChatGPT',
  'Search the web',
]

describe('the real Claude app Code tab', () => {
  it.each(SAMPLES.map((s, i) => [i + 1, s] as const))('sample %i is a coding session', (_i, s) => {
    const kinds = [...codingEvidence(text(s), 'Claude').keys()]
    expect(kinds).toEqual(expect.arrayContaining(['header', 'agent']))
    expect(looksLikeCodingSession(text(s), 'Claude')).toBe(true)
    expect(detectAssistant(claudeWin(s))).toBeNull()
  })

  it('reads "Ran 2 commands" as a tool run and the checklist as a plan', () => {
    expect(codingEvidence(['Ran 2 commands'], null).get('tool')).toBe(1)
    expect(codingEvidence(['done', 'Fix it', 'in progress', 'Ship it'], null).get('plan')).toBe(2)
    expect(codingEvidence(['done'], null).has('plan')).toBe(false)
  })

  it('keeps the Claude app chat about programming an AI chat', () => {
    expect(looksLikeCodingSession(text(CLAUDE_STUDY_CHAT), 'Claude')).toBe(false)
    expect(detectAssistant(claudeWin(CLAUDE_STUDY_CHAT))?.assistant.key).toBe('claude')
  })

  it('keeps ChatGPT a chat although its sidebar shows "Codex"', () => {
    const w = win({
      title: 'ChatGPT',
      url: 'https://chatgpt.com/',
      source: 'ocr',
      lines: CHATGPT_HOME,
    })
    expect(codingEvidence(text(CHATGPT_HOME), w.title).size).toBe(0)
    expect(detectAssistant(w)?.assistant.key).toBe('chatgpt')
  })
})

describe('episodes of a coding session', () => {
  it('are closed as already extracted, and the chat after them is not', () => {
    const closed: Episode[] = []
    const tracker = new AiChatTracker()
    const builder = new EpisodeBuilder({
      classify: (w) => tracker.classify(w),
      isAgentSession: (w) => tracker.isAgentSession(w),
      redact: () => false,
      onClose: (e) => closed.push(e),
      options: { minPersistDwellS: 0 },
    })
    const T0 = Date.parse('2026-10-24T09:00:00.000Z')
    const chat: LineSpec[] = [
      ['Why does a tertiary carbocation form faster in SN1?', 'right'],
      ['Alkyl groups donate electron density and stabilise the positive charge.', 'left'],
      'Reply to Claude…',
    ]
    let t = 0
    for (const s of SAMPLES)
      for (let k = 0; k < 5; k++, t += 2) builder.ingest(batch(T0 + t * 1000, claudeWin(s)))
    for (let k = 0; k < 10; k++, t += 2) builder.ingest(batch(T0 + t * 1000, claudeWin(chat)))
    builder.closeAll()
    const code = closed.filter((e) => e.aiProvider === null)
    const study = closed.filter((e) => e.aiProvider === 'claude')
    expect(code.length).toBeGreaterThan(0)
    expect(code.every((e) => e.extracted && e.kind === 'other')).toBe(true)
    expect(study).toHaveLength(1)
    expect(study[0]?.extracted).toBe(false)
    expect(study[0]?.text).toContain('tertiary carbocation')
    expect(study[0]?.text).not.toContain('Now working in')
  })
})
