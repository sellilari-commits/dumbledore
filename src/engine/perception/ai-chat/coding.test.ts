/**
 * Coding sessions are not study chats: the Claude app's Code tab, Codex in the ChatGPT app,
 * claude.ai/code and editors/terminals, while the same apps' normal chats stay AI chats.
 */
import type { Episode } from '@shared/domain'
import type { FocusedElement } from '@shared/helper-protocol'
import { describe, expect, it } from 'vitest'
import { EpisodeBuilder } from '../episodes/builder'
import { batch, type LineSpec, win } from '../testing/frames'
import { codingEvidence, looksLikeCodingSession } from './coding'
import { detectAssistant } from './detector'
import { AiChatTracker } from './tracker'

const CLAUDE = 'com.anthropic.claudefordesktop'

/** The Claude app's normal chat: a study conversation. */
const CLAUDE_CHAT: LineSpec[] = [
  'New chat',
  'Chats',
  ['Why does osmosis move water toward the saltier side?', 'right'],
  ['Water moves to where it is less concentrated, so it flows toward more dissolved salt.', 'left'],
  'Reply to Claude…',
  'Opus 5.5',
  'Claude can make mistakes. Please double-check responses.',
]

/** The Claude app's Code tab, as recorded in the real run (tool runs, paths, a model picker). */
const CLAUDE_CODE_TAB: LineSpec[] = [
  'Code',
  'dumbledore',
  'main',
  '⏺ Bash(npx vitest run src/engine/perception)',
  '⎿ Test Files 12 passed (12)',
  '⏺ Read src/engine/perception/ai-chat/detector.ts',
  '⏺ Update(src/engine/perception/ai-chat/tracker.ts)',
  '+12 -3',
  'Commit changes',
  'Opus 5.5',
  'Reply to Claude…',
]

const lines = (spec: LineSpec[]) => spec.map((l) => (typeof l === 'string' ? l : l[0]))
const claudeWin = (spec: LineSpec[], title = 'Claude') =>
  win({ pid: 42, bundleId: CLAUDE, appName: 'Claude', windowId: 3, title, url: null, lines: spec })

describe('coding sessions', () => {
  it('keeps the Claude app chat an AI chat', () => {
    expect(detectAssistant(claudeWin(CLAUDE_CHAT))?.assistant.key).toBe('claude')
  })

  it('does not count the Claude app Code tab', () => {
    expect(detectAssistant(claudeWin(CLAUDE_CODE_TAB))).toBeNull()
  })

  it.each<[string, string[], string | null]>([
    ['tool runs + paths', ['Bash(npm test)', 'Read src/app.ts', 'src/lib/util.ts'], null],
    ['a permission prompt + a diff', ['Allow once', 'Deny', '@@ -1,4 +1,6 @@'], null],
    ['an agent control + shell + path', ['Accept edits', 'git status', 'src/index.ts'], null],
    ['a coding title + one path', ['src/main.py'], 'Claude Code'],
  ])('reads a coding agent from several kinds of evidence: %s', (_name, screen, title) => {
    expect(looksLikeCodingSession(screen, title)).toBe(true)
  })

  it('needs an agent-only kind: a programming study chat stays a chat', () => {
    const study = [
      'How do I read a CSV file in Python?',
      'Install pandas first:',
      'pip install pandas',
      'Then load it in data/load.py:',
      'df = pd.read_csv("grades.csv")',
      'python3 data/load.py',
    ]
    expect(codingEvidence(study, null).has('tool')).toBe(false)
    expect(looksLikeCodingSession(study, null)).toBe(false)
    const chat = win({ title: 'CSV help', url: 'https://chatgpt.com/c/1', lines: study })
    expect(detectAssistant(chat)?.assistant.key).toBe('chatgpt')
  })

  it('does not count one stray agent word', () => {
    expect(looksLikeCodingSession(['Allow once', 'Photosynthesis needs light.'], null)).toBe(false)
  })

  it.each([
    [
      'ChatGPT app in Codex mode',
      win({ bundleId: 'com.openai.codex', url: null, lines: lines(CLAUDE_CODE_TAB) }),
    ],
    ['claude.ai/code', win({ url: 'https://claude.ai/code/session_1', lines: ['Claude Code'] })],
    ['chatgpt.com/codex', win({ url: 'https://chatgpt.com/codex/tasks/1' })],
    ['VS Code', win({ bundleId: 'com.microsoft.VSCode', url: null })],
    ['iTerm running an agent', win({ bundleId: 'com.googlecode.iterm2', url: null })],
  ])('is not a study chat: %s', (_name, w) => {
    expect(detectAssistant(w)).toBeNull()
  })
})

describe('switching between the Chat and Code tabs of one window', () => {
  it('reports the chat, then nothing while coding, then the chat again', () => {
    const seen: (string | null)[] = []
    const tracker = new AiChatTracker((c) => seen.push(c?.key ?? null))
    tracker.observeFrontmost(claudeWin(CLAUDE_CHAT))
    tracker.observeFrontmost(claudeWin([], 'Claude')) // unchanged frame keeps the chat
    tracker.observeFrontmost(claudeWin(CLAUDE_CODE_TAB))
    tracker.observeFrontmost(claudeWin([], 'Claude')) // unchanged frame keeps "coding"
    tracker.observeFrontmost(claudeWin(CLAUDE_CHAT))
    expect(seen).toEqual(['claude', null, 'claude'])
  })

  it('ignores a composer focused inside a coding session', () => {
    const tracker = new AiChatTracker()
    tracker.observeFrontmost(claudeWin(CLAUDE_CODE_TAB))
    tracker.observeFocus(focused({ pid: 42, placeholder: 'Reply to Claude…' }))
    expect(tracker.get()).toBeNull()
  })

  it('keeps coding text out of chat episodes and chat text out of coding ones', () => {
    const closed: Episode[] = []
    const tracker = new AiChatTracker()
    const builder = new EpisodeBuilder({
      classify: (w) => tracker.classify(w),
      redact: () => false,
      onClose: (e) => closed.push(e),
      options: { minPersistDwellS: 0 },
    })
    const T0 = Date.parse('2026-10-24T09:00:00.000Z')
    for (let t = 0; t <= 20; t += 2) builder.ingest(batch(T0 + t * 1000, claudeWin(CLAUDE_CHAT)))
    for (let t = 22; t <= 40; t += 2)
      builder.ingest(batch(T0 + t * 1000, claudeWin(CLAUDE_CODE_TAB)))
    builder.closeAll()
    const chat = closed.filter((e) => e.kind === 'ai_chat')
    const code = closed.filter((e) => e.kind !== 'ai_chat')
    expect(chat.map((e) => e.aiProvider)).toEqual(['claude'])
    expect(chat[0]?.text).toContain('osmosis')
    expect(chat[0]?.text).not.toContain('Bash(')
    expect(code).toHaveLength(1)
    expect(code[0]?.aiProvider).toBeNull()
    expect(code[0]?.text).not.toContain('osmosis')
  })
})

function focused(over: Partial<FocusedElement>): FocusedElement {
  return {
    pid: 10,
    bundleId: 'com.google.Chrome',
    appName: 'Google Chrome',
    role: 'AXTextArea',
    subrole: null,
    editable: true,
    isSecure: false,
    frame: { x: 300, y: 700, width: 720, height: 48 },
    caret: null,
    placeholder: null,
    valueLength: 0,
    ref: 'r1',
    ...over,
  }
}
