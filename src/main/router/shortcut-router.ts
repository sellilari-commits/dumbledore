/**
 * Shortcut router: turns a trigger-key gesture or an orb click into the right action (F4).
 *
 * It gathers the context (open surfaces, session, AI chat, focused element), reads the field
 * value / selection from the helper only when the decision table needs them on an explicit tap,
 * and carries out the decision. Writing work runs as PendingWork, so Esc cancels it and nothing
 * is written if the app or field changed meanwhile (ChatWriter checks the snapshot).
 */
import type {
  HelperClient,
  PerceptionService,
  PromptService,
  QuizService,
  Repos,
  StudyService,
} from '@engine/contracts'
import type { FocusedElement, Gesture } from '@shared/helper-protocol'
import { type ChatWriter, snapshotOf } from '../chat/chat-writer'
import type { AskFlow } from '../flows/ask-flow'
import { chatContext } from '../flows/context'
import type { SessionFlow } from '../flows/session-flow'
import type { Thinking } from '../flows/thinking'
import type { ToastSpec } from '../overlay/toasts'
import type { SurfaceControl } from '../platform'
import { type Decision, decide, type RouteContext } from './decide'
import type { PendingWork } from './pending'
import type { SuggestionCache } from './suggestions'

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

const preview = (text: string, max = 140) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

export function explainPrompt(selection: string): string {
  return [
    "I'm studying this and want to really understand it:",
    `"${preview(selection, 600)}"`,
    'Explain it in 3 numbered points with one concrete example. No greetings or small talk. Short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.',
  ].join('\n')
}

export class ShortcutRouter {
  /** The last decision, for logs and the test-control channel. */
  lastDecision: Decision | null = null

  constructor(private readonly deps: RouterDeps) {}

  async gesture(gesture: Gesture, opts: { secureInput?: boolean } = {}): Promise<Decision> {
    const { surfaces, overlay, study, perception } = this.deps
    const focused = gesture === 'holdEnd' ? null : await this.focused()
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
    let decision = decide(gesture, ctx)
    while (decision.kind === 'need') {
      if (decision.what === 'fieldText') ctx.fieldText = await this.readText('ax.readFocusedValue')
      else ctx.selection = await this.readText('ax.selectedText')
      decision = decide(gesture, ctx)
    }
    this.lastDecision = decision
    await this.execute(decision, focused)
    return decision
  }

  orbClick(): Promise<Decision> {
    return this.gesture('tap')
  }

  orbLongPress(): Promise<Decision> {
    return this.gesture('holdStart')
  }

  chipClick(): Promise<Decision> {
    return this.gesture('tap')
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
      case 'refuseSecure':
        overlay.showToast({
          kind: 'info',
          title: 'Password field',
          body: 'Dumbledore never reads or writes password fields.',
          ttlMs: 4000,
        })
        return
      case 'unreadable':
        overlay.showToast({
          kind: 'error',
          title: "Couldn't read that field",
          body: 'Select the text and tap again, or use the ask bar (hold the key).',
          ttlMs: 6000,
        })
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
          if (s.coachTip)
            overlay.showToast({
              kind: 'tip',
              title: 'Why this prompt works',
              body: s.coachTip,
              ttlMs: 12_000,
            })
        })
        return
      case 'improve':
        await pending.run(async (signal) => {
          const r = await thinking.run('Improving your prompt…', () =>
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
          if (out.ok && r.coachTip) {
            overlay.showToast({
              kind: 'tip',
              title: 'Prompt improved',
              body: `${r.coachTip} ⌘Z undoes it.`,
              ttlMs: 12_000,
            })
          }
        })
        return
      case 'selection':
        this.selectionToast(d.text)
        return
      case 'picker':
        await surfaces.open('panel', { route: '/picker' })
        return
      case 'togglePanel':
        if (surfaces.isOpen('panel')) await surfaces.close('panel')
        else await surfaces.open('panel', { route: '/' })
        return
    }
  }

  private selectionToast(text: string): void {
    const assistant = this.deps.perception.aiChat()?.assistant ?? 'ChatGPT'
    this.deps.overlay.showToast({
      kind: 'info',
      title: 'Selected text',
      body: preview(text),
      actions: [
        {
          id: 'explain',
          label: `Explain with ${assistant}`,
          primary: true,
          run: () => this.explain(text),
        },
        { id: 'roadmap', label: 'Add to a roadmap', run: () => this.addToRoadmap(text) },
        { id: 'quiz', label: 'Quiz me', run: () => this.quizMe(text) },
      ],
    })
  }

  private async explain(text: string): Promise<void> {
    await this.deps.writer.write({ text: explainPrompt(text), mode: 'insert', target: 'chat' })
  }

  private async addToRoadmap(text: string): Promise<void> {
    const subjectId = this.deps.repos.settings.get().focusSubjectId
    await this.deps.sessions.start({ subjectId, goal: preview(text, 200), question: null })
  }

  private async quizMe(text: string): Promise<void> {
    const { repos, quizzes, overlay, ask } = this.deps
    const lower = text.toLowerCase()
    const ids = repos.subjects
      .list({ status: ['active'] })
      .flatMap((s) => repos.concepts.listBySubject(s.id))
      .filter((c) => lower.includes(c.name.toLowerCase()))
      .map((c) => c.id)
    if (ids.length > 0) {
      const quiz = await quizzes.startReview(ids)
      overlay.openQuiz(quiz.id)
      return
    }
    await ask.instruction(`Quiz me on this: ${preview(text, 300)}`)
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
