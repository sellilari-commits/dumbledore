/**
 * Caches the suggested prompt for an empty chat box, so the chip beside the docked orb and the
 * tap that inserts it use the same text (and the LLM is called once). Keyed on the AI chat and
 * the session position; entries live 60 s.
 */
import type { Clock } from '@engine/clock'
import type { ChatContext, PromptService } from '@engine/contracts'

export interface Suggestion {
  prompt: string
  coachTip: string | null
}

const TTL_MS = 60_000

export class SuggestionCache {
  private cached: { key: string; at: number; value: Suggestion } | null = null
  private inflight: { key: string; promise: Promise<Suggestion> } | null = null

  constructor(
    private readonly prompts: Pick<PromptService, 'suggest'>,
    private readonly context: () => ChatContext,
    private readonly keyOf: () => string,
    private readonly clock: Clock,
  ) {}

  async get(): Promise<Suggestion> {
    const key = this.keyOf()
    const now = this.clock.now()
    if (this.cached && this.cached.key === key && now - this.cached.at < TTL_MS) {
      return this.cached.value
    }
    if (this.inflight?.key === key) return this.inflight.promise
    const promise = this.prompts.suggest(this.context()).then((value) => {
      this.cached = { key, at: this.clock.now(), value }
      return value
    })
    this.inflight = { key, promise }
    try {
      return await promise
    } finally {
      if (this.inflight?.promise === promise) this.inflight = null
    }
  }

  invalidate(): void {
    this.cached = null
    this.inflight = null
  }
}
