/**
 * PromptService (lane L4, PLAN F3/P8/P9): the suggestion for an empty chat box and the improver
 * for the student's own draft. Both are `write`-tier calls with a 2.5 s budget and a no-LLM
 * fallback (the top candidate, or the draft unchanged).
 */
import type { SessionState } from '@shared/state'
import type { ChatContext, PromptService } from '../../contracts'
import { withDeadline } from './deadline'
import { DEFAULT_PROMPT_OPTIONS, type PromptDeps, type PromptOptions } from './deps'
import { buildCandidates } from './prompt-candidates'
import { head, languageOf, profileText } from './text'

export interface PromptResult {
  prompt: string
  coachTip: string | null
}

export class PromptServiceImpl implements PromptService {
  private readonly opts: PromptOptions

  constructor(private readonly deps: PromptDeps) {
    this.opts = { ...DEFAULT_PROMPT_OPTIONS, ...deps.options }
  }

  async suggest(ctx: ChatContext): Promise<PromptResult> {
    const { repos, brain, clock } = this.deps
    const session = this.session()
    const candidates = buildCandidates({
      repos,
      session,
      pageContext: ctx.pageContext,
      nowIso: clock.nowIso(),
    })
    const top = candidates[0]
    const fallback: PromptResult = { prompt: top?.text ?? '', coachTip: null }
    if (!top) return fallback
    const profile = repos.profile.get()
    try {
      const out = await withDeadline(clock, this.opts.timeoutMs, 'suggestPrompt', (call) =>
        brain.suggestPrompt(
          {
            assistant: ctx.assistant ?? this.opts.defaultAssistant,
            language: languageOf(profile),
            profile: profileText(profile),
            candidates,
            context: this.contextText(session, ctx),
          },
          call,
        ),
      )
      const prompt = out.prompt.trim()
      return prompt ? { prompt, coachTip: out.coachTip.trim() || null } : fallback
    } catch (error) {
      console.warn('[prompts] suggest fell back to the top candidate', error)
      return fallback
    }
  }

  async improve(draft: string, ctx: ChatContext): Promise<PromptResult> {
    if (!draft.trim()) return this.suggest(ctx)
    const { repos, brain, clock } = this.deps
    const profile = repos.profile.get()
    try {
      const out = await withDeadline(clock, this.opts.timeoutMs, 'improvePrompt', (call) =>
        brain.improvePrompt(
          {
            assistant: ctx.assistant ?? this.opts.defaultAssistant,
            language: languageOf(profile),
            profile: profileText(profile),
            draft: draft.trim(),
            context: this.contextText(this.session(), ctx),
          },
          call,
        ),
      )
      const prompt = out.prompt.trim()
      return prompt
        ? { prompt, coachTip: out.coachTip.trim() || null }
        : { prompt: draft, coachTip: null }
    } catch (error) {
      console.warn('[prompts] improve fell back to the draft', error)
      return { prompt: draft, coachTip: null }
    }
  }

  private session(): SessionState | null {
    try {
      return this.deps.session?.() ?? null
    } catch {
      return null
    }
  }

  /** Short context for the writer: the running session and what is on screen. */
  private contextText(session: SessionState | null, ctx: ChatContext): string {
    const parts: string[] = []
    if (session && session.phase !== 'complete') {
      const item = session.items[session.index]
      parts.push(
        `Study session: ${session.subjectName} — ${session.title} (step ${session.index + 1} of ${session.total}${item ? `: ${item.title}` : ''})`,
      )
    }
    if (ctx.pageContext.trim())
      parts.push(`On screen: ${head(ctx.pageContext, this.opts.contextChars)}`)
    return parts.join('\n')
  }
}

export function createPromptService(deps: PromptDeps): PromptServiceImpl {
  return new PromptServiceImpl(deps)
}
