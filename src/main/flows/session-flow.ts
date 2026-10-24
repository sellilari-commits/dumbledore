/**
 * Study-session flow (F2): asks StudyService for the next StepInstruction and carries it out —
 * paste the prompt into the AI chat (ChatWriter) with a coach-tip toast, open the checkpoint quiz
 * card, or finish the roadmap and schedule the follow-up.
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
  overlay: { openQuiz(quizId: string): void; showToast(spec: ToastSpec): string }
  /** Runs a coach action (late-bound: CoachActions depends on this flow). */
  runAction?: (action: CoachAction) => Promise<void>
}

export interface StepOptions {
  /** The field the user tapped in; nothing is written if it changed meanwhile. */
  expect?: FieldSnapshot | null
  /** 'replaceAll' when the prompt replaces a `/d …` instruction in the chat box. */
  mode?: 'insert' | 'replaceAll'
  signal?: AbortSignal
}

export interface StepResult {
  session: SessionState | null
  instruction: StepInstruction
  write: WriteOutcome | null
}

export class SessionFlow {
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
    const { overlay, writer, surfaces, study } = this.deps
    let write: WriteOutcome | null = null
    if (opts.signal?.aborted) return { session: study.current(), instruction, write }
    switch (instruction.kind) {
      case 'paste': {
        await this.closeTypingSurfaces()
        write = await writer.write({
          text: instruction.text,
          mode: opts.mode ?? 'insert',
          target: 'chat',
          expect: opts.expect,
          signal: opts.signal,
        })
        if (write.ok && instruction.coachTip) {
          overlay.showToast({
            kind: 'tip',
            title: 'Why this prompt works',
            body: instruction.coachTip,
            ttlMs: 12_000,
          })
        }
        break
      }
      case 'quiz':
        if (surfaces.isOpen('panel')) await surfaces.close('panel')
        overlay.openQuiz(instruction.quizId)
        break
      case 'complete':
        this.complete(instruction.summary)
        break
      case 'wait':
        overlay.showToast({
          kind: 'info',
          title: 'One moment',
          body: instruction.reason,
          ttlMs: 6000,
        })
        break
    }
    return { session: study.current(), instruction, write }
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
