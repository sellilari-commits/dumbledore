/**
 * Fake PerceptionService (lane L3 builds the real one).
 *
 * Detects an open AI chat from the frontmost app (bundle id or browser URL) whenever the helper
 * reports an app switch or a focus change, and keeps a simple "Right now" context. Tests and the
 * test-control channel can also set the AI chat, the "now" context and the chat excerpt directly.
 */
import type { Clock } from '@engine/clock'
import type { AiChatInfo, HelperClient, PerceptionService } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { FrontmostInfo } from '@shared/helper-protocol'
import { ASSISTANT_NAMES, type AssistantKey } from '@shared/llm'
import type { NowContext } from '@shared/state'

const CHAT_BUNDLES: Record<string, AssistantKey> = {
  'com.openai.chat': 'chatgpt',
  'com.anthropic.claudefordesktop': 'claude',
  'ai.perplexity.mac': 'perplexity',
}

const CHAT_HOSTS: [RegExp, AssistantKey][] = [
  [/(^|\.)chatgpt\.com$|^chat\.openai\.com$/, 'chatgpt'],
  [/(^|\.)claude\.ai$/, 'claude'],
  [/^gemini\.google\.com$/, 'gemini'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'],
  [/^copilot\.microsoft\.com$/, 'copilot'],
  [/^chat\.mistral\.ai$/, 'mistral'],
  [/^chat\.deepseek\.com$/, 'deepseek'],
  [/(^|\.)grok\.com$/, 'grok'],
]

/** Which AI chat (if any) the frontmost window is. */
export function detectAiChat(front: FrontmostInfo): AiChatInfo | null {
  let key: AssistantKey | undefined = CHAT_BUNDLES[front.bundleId]
  if (!key && front.url) {
    try {
      const host = new URL(front.url).hostname
      key = CHAT_HOSTS.find(([re]) => re.test(host))?.[1]
    } catch {
      key = undefined
    }
  }
  if (!key) return null
  return {
    key,
    assistant: ASSISTANT_NAMES[key],
    pid: front.pid,
    bundleId: front.bundleId,
    url: front.url,
    windowTitle: front.windowTitle,
  }
}

export interface FakePerceptionOptions {
  bus: EngineBus
  clock: Clock
  helper?: HelperClient
  /** Dumbledore's own pid: switching to our own windows keeps the previous context. */
  ownPid?: number
}

export class FakePerceptionService implements PerceptionService {
  private enabled = true
  private running = false
  private chat: AiChatInfo | null = null
  private nowCtx: NowContext | null = null
  private nowSince = 0
  private excerpt = ''
  private page = ''
  private readonly offs: (() => void)[] = []

  constructor(private readonly opts: FakePerceptionOptions) {}

  start(): void {
    if (this.running) return
    this.running = true
    const refresh = () => void this.refresh()
    this.offs.push(this.opts.bus.on('helper:appActivated', refresh))
    this.offs.push(this.opts.bus.on('helper:focus', refresh))
  }

  stop(): void {
    this.running = false
    for (const off of this.offs.splice(0)) off()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isActive(): boolean {
    return this.running && this.enabled
  }

  now(): NowContext | null {
    if (!this.nowCtx) return null
    const minutes = Math.floor((this.opts.clock.now() - this.nowSince) / 60_000)
    return { ...this.nowCtx, minutes }
  }

  aiChat(): AiChatInfo | null {
    return this.chat
  }

  chatExcerpt(maxChars: number): string {
    return this.excerpt.slice(-maxChars)
  }

  pageContext(maxChars: number): string {
    return this.page.slice(-maxChars)
  }

  // ─── Hooks for tests, the demo and the test-control channel ─────────────────────────────

  setAiChat(chat: AiChatInfo | null): void {
    if (JSON.stringify(chat) === JSON.stringify(this.chat)) return
    this.chat = chat
    this.opts.bus.emit('perception:aiChat', { chat })
  }

  setNow(now: NowContext | null): void {
    this.nowCtx = now
    this.nowSince = this.opts.clock.now() - (now?.minutes ?? 0) * 60_000
    this.opts.bus.emit('perception:now', { now: this.now() })
  }

  setChatExcerpt(text: string): void {
    this.excerpt = text
  }

  setPageContext(text: string): void {
    this.page = text
  }

  /** Re-reads the frontmost app from the helper and updates the AI chat and "now" context. */
  async refresh(): Promise<void> {
    const helper = this.opts.helper
    if (helper?.status !== 'connected' || !this.enabled) return
    let front: FrontmostInfo | null
    try {
      front = await helper.call('frontmost', {})
    } catch {
      return
    }
    if (!front || front.pid === this.opts.ownPid) return
    const chat = detectAiChat(front)
    this.setAiChat(chat)
    const sameApp = this.nowCtx?.app === front.appName && this.nowCtx?.url === front.url
    if (!sameApp) {
      this.setNow({
        app: front.appName,
        title: front.windowTitle,
        url: front.url,
        minutes: 0,
        kind: chat ? 'ai_chat' : 'reading',
        subjectId: null,
        suggestion: null,
      })
    }
  }
}
