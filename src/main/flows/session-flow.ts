/**
 * Study-session flow (F2): asks StudyService for the next StepInstruction and carries it out —
 * paste the prompt into the AI chat (ChatWriter) with a coach-tip toast, ask "quiz or continue?" at
 * a checkpoint (Quiz opens the quiz card, Continue skips it and pastes the next step), or finish
 * the roadmap and schedule the follow-up. A step counts as delivered only once the
 * paste is confirmed: a failed, cancelled or skipped paste is reported back (`pasteFailed`), so the
 * next tap pastes the same step again; the failure toast's "Try again" does that at once.
 */
import type {
  ChatContext,
  FollowUpService,
  PerceptionService,
  StudyService,
} from '@engine/contracts'
import type { CoachAction } from '@shared/domain'
import type { SessionState, StartSessionInput, StepInstruction } from '@shared/state'
import type { ChatWriter, FieldSnapshot, WriteOutcome } from '../chat/chat-writer'
import type { ToastSpec } from '../overlay/toasts'
import type { SurfaceControl } from '../platform'
import { chatContext } from './context'
import type { Thinking } from './thinking'

export interface SessionFlowDeps {
  study: StudyService
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  followUps: Pick<FollowUpService, 'onSessionComplete'>
  writer: ChatWriter
  thinking: Thinking
  surfaces: SurfaceControl
  overlay: {
    openQuiz(quizId: string): void
    showToast(spec: ToastSpec): string
    removeToast?(toastId: string): void
  }
  /** Runs a coach action (late-bound: CoachActions depends on this flow). */
  runAction?: (action: CoachAction) => Promise<void>
}

export interface StepOptions {
  /** The field the user tapped in; nothing is written if it changed meanwhile. */
  expect?: FieldSnapshot | null
  /** 'replaceAll' when the prompt replaces a `/d …` instruction in the chat box. */
  mode?: 'insert' | 'replaceAll'
  signal?: AbortSignal
  /**
   * Plan and start, but keep the first prompt for the student's next tap in their AI chat: nothing
   * is pasted now (planning from the double-tap chat, while the student is talking to Dumbledore).
   */
  hold?: boolean
}

export interface StepResult {
  session: SessionState | null
  instruction: StepInstruction
  write: WriteOutcome | null
}

export const CHECKPOINT_QUESTION = 'Do you want to have a quiz or continue?'

export class SessionFlow {
  /** The open "quiz or continue?" box, replaced when the question is asked again. */
  private choiceToast: string | null = null

  constructor(private readonly deps: SessionFlowDeps) {}

  /** Late binding: CoachActions is built after this flow and depends on it. */
  bindActions(runAction: (action: CoachAction) => Promise<void>): void {
    this.deps.runAction = runAction
  }

  private context(): ChatContext {
    return chatContext(this.deps.perception)
  }

  async start(input: StartSessionInput, opts: StepOptions = {}): Promise<StepResult> {
    const instruction = await this.deps.thinking.run('Building your roadmap…', () =>
      this.deps.study.start(input, this.context()),
    )
    return this.perform(instruction, opts)
  }

  async next(opts: StepOptions = {}): Promise<StepResult> {
    const instruction = await this.deps.thinking.run('Writing the next prompt…', () =>
      this.deps.study.next(this.context()),
    )
    return this.perform(instruction, opts)
  }

  /** Carries out what the study engine asked for. */
  async perform(instruction: StepInstruction, opts: StepOptions = {}): Promise<StepResult> {
    const { overlay, writer, study } = this.deps
    let write: WriteOutcome | null = null
    // The session moved past the checkpoint: its "quiz or continue?" box is stale.
    if (instruction.kind !== 'quiz') this.dropChoice()
    if (opts.signal?.aborted) {
      if (instruction.kind === 'paste') study.pasteFailed(instruction.itemId)
      return { session: study.current(), instruction, write }
    }
    switch (instruction.kind) {
      case 'paste': {
        if (opts.hold) {
          study.pasteFailed(instruction.itemId) // the next tap in the AI chat delivers it
          break
        }
        try {
          await this.closeTypingSurfaces()
          write = await writer.write({
            text: instruction.text,
            mode: opts.mode ?? 'insert',
            target: 'chat',
            expect: opts.expect,
            signal: opts.signal,
            retry: () => this.retryStep(instruction.itemId),
          })
        } finally {
          if (!write?.ok) study.pasteFailed(instruction.itemId)
        }
        break
      }
      case 'quiz':
        this.askCheckpoint(instruction.quizId, instruction.itemId)
        break
      case 'complete':
        this.complete(instruction.summary)
        break
      case 'wait':
        // Answers the student's own tap (e.g. the AI hasn't answered this step yet).
        overlay.showToast({
          kind: 'info',
          purpose: 'step-waiting',
          title: 'One moment',
          body: instruction.reason,
          ttlMs: 4000,
        })
        break
    }
    return { session: study.current(), instruction, write }
  }

  /**
   * A checkpoint is next: ask "quiz or continue?" instead of opening the quiz. The box stays until
   * answered; closing it leaves the checkpoint current, so the next tap asks again.
   */
  private askCheckpoint(quizId: string, itemId: string): void {
    this.dropChoice()
    const id = this.deps.overlay.showToast({
      kind: 'tip',
      purpose: 'checkpoint-choice',
      title: 'Checkpoint',
      body: CHECKPOINT_QUESTION,
      ttlMs: 0,
      actions: [
        { id: 'quiz', label: 'Quiz', primary: true, run: () => this.openQuiz(quizId) },
        {
          id: 'continue',
          label: 'Continue',
          run: async () => {
            await this.continuePast(itemId)
          },
        },
      ],
      onDismiss: () => {
        this.choiceToast = null
      },
    })
    this.choiceToast = id || null
  }

  private dropChoice(): void {
    if (this.choiceToast) this.deps.overlay.removeToast?.(this.choiceToast)
    this.choiceToast = null
  }

  /** "Quiz": the checkpoint quiz card, as before. */
  async openQuiz(quizId: string): Promise<void> {
    this.choiceToast = null
    const { surfaces, overlay } = this.deps
    if (surfaces.isOpen('panel')) await surfaces.close('panel')
    overlay.openQuiz(quizId)
  }

  /** "Continue": skip the checkpoint (its concepts carry on) and paste the next step. */
  async continuePast(itemId: string): Promise<StepResult | null> {
    this.choiceToast = null
    try {
      const instruction = await this.deps.thinking.run('Writing the next prompt…', () =>
        this.deps.study.skipCheckpoint(itemId, this.context()),
      )
      return await this.perform(instruction)
    } catch (error) {
      console.warn('[session] continue past checkpoint failed', error)
      return null
    }
  }

  /**
   * "Try again" on a failed paste: pastes the step again while it is still the undelivered
   * current step (a later tap may already have pasted it, or the session moved on).
   */
  async retryStep(itemId: string): Promise<StepResult | null> {
    const session = this.deps.study.current()
    const item = session?.items[session.index]
    if (item?.id !== itemId || item.kind !== 'learn' || item.promptSent !== null) return null
    return this.next()
  }

  private complete(summary: string): void {
    const session = this.deps.study.current()
    if (session) this.deps.followUps.onSessionComplete(session.roadmapId)
    const runAction = this.deps.runAction
    this.deps.overlay.showToast({
      kind: 'info',
      title: 'Roadmap complete',
      body: `${summary}. A follow-up review is scheduled.`,
      actions:
        session && runAction
          ? [
              {
                id: 'exam',
                label: 'Final exam now',
                primary: true,
                run: () =>
                  runAction({
                    type: 'create_exam',
                    spec: {
                      subjectIds: [session.subjectId],
                      count: 10,
                      focus: 'everything',
                      difficulty: 'mixed',
                    },
                  }),
              },
              { id: 'later', label: 'Later' },
            ]
          : [],
      ttlMs: 20_000,
    })
  }

  /** Typing surfaces close before a paste so focus can return to the chat. */
  private async closeTypingSurfaces(): Promise<void> {
    const { surfaces } = this.deps
    if (surfaces.isOpen('askbar')) await surfaces.close('askbar')
    if (surfaces.isOpen('panel')) await surfaces.close('panel')
  }
}
