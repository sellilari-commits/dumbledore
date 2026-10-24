/**
 * Shortcut router: turns a trigger-key gesture or an orb click into the right action (F4).
 *
 * It gathers the context (open surfaces, session, AI chat, focused element), reads the field
 * value / selection from the helper only when the decision table needs them on an explicit tap,
 * and carries out the decision. Writing work runs as PendingWork, so Esc cancels it and nothing
 * is written if the app or field changed meanwhile (ChatWriter checks the snapshot).
 *
 * A key tap waits out the double-tap window first (TapGuard), so a double-tap only opens the
 * chat window. A tap that rewrites shows the orb thinking while the rewrite runs. A hold only
 * opens the prompt box (ask bar route 'prompt'); its release does nothing.
 */
import type {
  HelperClient,
  PerceptionService,
  PromptService,
  QuizService,
  Repos,
  StudyService,
} from '@engine/contracts'
import type { FocusedElement } from '@shared/helper-protocol'
import { type ChatWriter, snapshotOf } from '../chat/chat-writer'
import type { AskFlow } from '../flows/ask-flow'
import { chatContext } from '../flows/context'
import type { SessionFlow } from '../flows/session-flow'
import type { Thinking } from '../flows/thinking'
import type { ToastSpec } from '../overlay/toasts'
import type { SurfaceControl } from '../platform'
import { type Decision, decide, type RouteContext, type RouteInput } from './decide'
import { REFUSE_SECURE, unreadableToast } from './hints'
import { lastStudiedSubject } from './last-subject'
import type { PendingWork } from './pending'
import { selectionToast } from './selection-actions'
import type { SuggestionCache } from './suggestions'
import { TapGuard } from './tap-guard'

export interface RouterDeps {
  helper: HelperClient
  ownPid: number
  repos: Repos
  study: Pick<StudyService, 'current'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  prompts: Pick<PromptService, 'improve'>
  quizzes: Pick<QuizService, 'startReview'>
  suggestions: Pick<SuggestionCache, 'get' | 'invalidate'>
  surfaces: SurfaceControl
  overlay: {
    isQuizOpen(): boolean
    openQuiz(quizId: string): void
    showToast(spec: ToastSpec): string
  }
  sessions: Pick<SessionFlow, 'next' | 'start'>
  ask: Pick<AskFlow, 'instruction'>
  writer: Pick<ChatWriter, 'write'>
  thinking: Thinking
  pending: PendingWork
}

export interface GestureOptions {
  secureInput?: boolean
  /** 'key' (default): the trigger key, which can double-tap. 'mouse' / 'chord' act at once. */
  source?: 'key' | 'mouse' | 'chord'
}

export class ShortcutRouter {
  /** The last decision, for logs and the test-control channel. */
  lastDecision: Decision | null = null

  private readonly tapGuard: TapGuard

  constructor(private readonly deps: RouterDeps) {
    this.tapGuard = new TapGuard(() => deps.repos.settings.get().shortcut.doubleTapMs)
  }

  async gesture(input: RouteInput, opts: GestureOptions = {}): Promise<Decision> {
    const { surfaces, overlay, study, perception } = this.deps
    // Armed before any await, so a double-tap that lands while we read the context still wins.
    const settled = input === 'tap' && (opts.source ?? 'key') === 'key' ? this.tapGuard.arm() : null
    if (input === 'doubleTap') this.tapGuard.supersede()
    const focused = input === 'holdEnd' ? null : await this.focused()
    const chat = perception.aiChat()
    const phase = study.current()?.phase
    const ctx: RouteContext = {
      askbarOpen: surfaces.isOpen('askbar'),
      quizOpen: overlay.isQuizOpen(),
      sessionActive: phase === 'step' || phase === 'checkpoint' || phase === 'planning',
      aiChat: chat ? { pid: chat.pid } : null,
      focused: focused
        ? {
            pid: focused.pid,
            editable: focused.editable,
            secure: focused.isSecure,
            valueLength: focused.valueLength,
          }
        : null,
      secureInput: opts.secureInput ?? false,
    }
    let decision = decide(input, ctx)
    while (decision.kind === 'need') {
      if (decision.what === 'fieldText') ctx.fieldText = await this.readText('ax.readFocusedValue')
      else ctx.selection = await this.readText('ax.selectedText')
      decision = decide(input, ctx)
    }
    if (settled && !(await settled)) decision = { kind: 'ignore' }
    this.lastDecision = decision
    await this.execute(decision, focused)
    return decision
  }

  orbClick(): Promise<Decision> {
    return this.gesture('tap', { source: 'mouse' })
  }

  /** Long-press on the orb: the chat window, like a double-tap (PLAN §5.6 mouse map). */
  orbLongPress(): Promise<Decision> {
    return this.gesture('doubleTap', { source: 'mouse' })
  }

  /** The chip inserts the suggested prompt, or rewrites typed text ("Improve prompt"). */
  chipClick(): Promise<Decision> {
    return this.gesture('chip', { source: 'mouse' })
  }

  async pillClick(): Promise<void> {
    await this.deps.surfaces.open('panel', { route: '/picker' })
  }

  /** Side stack ▸ Next / Quiz: the next step for the running session. */
  async sideNext(): Promise<void> {
    await this.deps.pending.run((signal) => this.deps.sessions.next({ signal }))
  }

  /** Esc: cancels pending work. True when something was cancelled. */
  cancel(): boolean {
    const cancelled = this.deps.pending.cancel()
    if (cancelled) {
      this.deps.overlay.showToast({
        kind: 'info',
        title: 'Cancelled',
        body: 'Nothing was written.',
        ttlMs: 2500,
      })
    }
    return cancelled
  }

  private async execute(d: Decision, focused: FocusedElement | null): Promise<void> {
    const { surfaces, overlay, pending, sessions, ask, writer, thinking, suggestions } = this.deps
    const snapshot = focused ? snapshotOf(focused) : null
    const inChatBox = this.inChat(focused)
    switch (d.kind) {
      case 'ignore':
      case 'need':
        return
      case 'enter':
        surfaces.pressEnter(d.surface)
        return
      case 'askbar':
        await surfaces.open('askbar', { nearField: focused?.editable ? focused.frame : null })
        return
      case 'focusAskbar':
        await surfaces.open('askbar')
        return
      case 'promptBox':
        await surfaces.open('askbar', { route: 'prompt' })
        return
      case 'studyLast': {
        const subjectId = lastStudiedSubject(this.deps.repos)
        if (subjectId === null) {
          await surfaces.open('panel', { route: '/picker' })
          return
        }
        await pending.run((signal) =>
          sessions.start(
            { subjectId, goal: null, question: null },
            { expect: inChatBox ? snapshot : null, signal },
          ),
        )
        return
      }
      case 'refuseSecure':
        overlay.showToast(REFUSE_SECURE)
        return
      case 'unreadable':
        overlay.showToast(unreadableToast(this.key()))
        return
      case 'sessionNext':
        await pending.run((signal) =>
          sessions.next({ expect: inChatBox ? snapshot : null, signal }),
        )
        return
      case 'instruction':
        await pending.run((signal) =>
          ask.instruction(d.text, {
            expect: inChatBox ? snapshot : null,
            mode: inChatBox && d.wholeField ? 'replaceAll' : 'insert',
            signal,
          }),
        )
        return
      case 'suggest':
        await pending.run(async (signal) => {
          const s = await thinking.run('Writing a prompt…', () => suggestions.get())
          if (signal.aborted) return
          const out = await writer.write({
            text: s.prompt,
            mode: 'insert',
            target: 'focused',
            expect: snapshot,
            signal,
          })
          if (!out.ok) return
          suggestions.invalidate()
        })
        return
      case 'improve':
        await pending.run(async (signal) => {
          const r = await thinking.run('Rewriting your prompt…', () =>
            this.deps.prompts.improve(d.draft, chatContext(this.deps.perception)),
          )
          if (signal.aborted) return
          const out = await writer.write({
            text: r.prompt,
            mode: 'replaceAll',
            target: 'focused',
            expect: snapshot,
            signal,
          })
        })
        return
      case 'selection':
        selectionToast(this.deps, d.text)
        return
      case 'togglePanel':
        if (surfaces.isOpen('panel')) await surfaces.close('panel')
        else await surfaces.open('panel', { route: '/' })
        return
    }
  }

  private key() {
    return this.deps.repos.settings.get().shortcut.key
  }

  private inChat(focused: FocusedElement | null): boolean {
    const chat = this.deps.perception.aiChat()
    return focused !== null && chat !== null && focused.pid === chat.pid
  }

  private async focused(): Promise<FocusedElement | null> {
    try {
      const el = await this.deps.helper.call('ax.focused', {}, { timeoutMs: 400 })
      return el && el.pid !== this.deps.ownPid ? el : null
    } catch {
      return null
    }
  }

  private async readText(
    method: 'ax.readFocusedValue' | 'ax.selectedText',
  ): Promise<string | null> {
    try {
      return (await this.deps.helper.call(method, {}, { timeoutMs: 600 })).text
    } catch {
      return null
    }
  }
}
