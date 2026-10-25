/**
 * Runs a CoachAction (from chat replies, ask-bar chips, nudges, toasts): start a roadmap, create
 * an exam and open it in the app, start a review quiz in the overlay, insert a prompt into the
 * chat, set the focus subject, open a subject page, replan a subject's roadmap from the
 * student's own words (adjust_roadmap, never pasted), save or undo a typed note, save what the
 * student asked or a course fact (ChatSaves) or undo it, or store feedback for the prompts of its
 * scope.
 *
 * Chat tools (the double-tap chat's loop): undo_save undoes a ChatSaves save, else a chat tool
 * write (UndoLog); an empty saveId is a receipt without Undo. run_tool is a chip the student
 * pressed (a delete to confirm, "Open ChatGPT and paste"): the call runs with ctx.confirmed and
 * its receipt (with its Undo) is added to the chat as a new message.
 */
import type { ChatRepo, FeedbackRepo, QuizService, SettingsRepo } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { CoachAction } from '@shared/domain'
import { APP_ROUTES } from '@shared/state'
import type { ChatWriter } from '../chat/chat-writer'
import type { ChatTools } from '../chat-tools'
import { receiptAction } from '../chat-tools'
import type { UndoLog } from '../chat-tools/undo'
import type { SurfaceControl } from '../platform'
import type { ChatSaves } from './chat-saves'
import type { RoadmapAdjust } from './roadmap-adjust'
import type { SessionFlow } from './session-flow'
import type { TypedNotes } from './typed-notes'

export interface CoachActionsDeps {
  sessions: Pick<SessionFlow, 'start'>
  quizzes: Pick<QuizService, 'createExam' | 'startReview'>
  settings: Pick<SettingsRepo, 'get' | 'update'>
  bus: EngineBus
  writer: Pick<ChatWriter, 'write'>
  surfaces: SurfaceControl
  overlay: { openQuiz(quizId: string): void }
  roadmapAdjust?: Pick<RoadmapAdjust, 'run'>
  notes?: Pick<TypedNotes, 'save' | 'undo'>
  feedback?: Pick<FeedbackRepo, 'add'>
  saves?: Pick<ChatSaves, 'apply' | 'undo'>
  /** The chat tools (run_tool chips) and their Undo log (undo_save of a tool write). */
  chatTools?: Pick<ChatTools, 'run'>
  undoLog?: Pick<UndoLog, 'undo'>
  /** The chat thread a run_tool receipt is added to, and how the open chat hears of it. */
  chat?: Pick<ChatRepo, 'append'>
  chatChanged?: () => void
}

/** The double-tap chat's thread (AskFlow's ASK_THREAD). */
const CHAT_THREAD = 'ask'

export class CoachActions {
  constructor(private readonly deps: CoachActionsDeps) {}

  async run(action: CoachAction): Promise<void> {
    const { deps } = this
    switch (action.type) {
      case 'start_roadmap':
        await deps.sessions.start({
          subjectId: action.subjectId,
          goal: action.goal,
          question: null,
        })
        return
      case 'create_exam': {
        const quiz = await deps.quizzes.createExam(action.spec)
        deps.bus.emit('memory:changed', { scope: 'quizzes', ids: [quiz.id] })
        await deps.surfaces.open('app', { route: APP_ROUTES.exam(quiz.id) })
        return
      }
      case 'start_review': {
        const quiz = await deps.quizzes.startReview(action.conceptIds)
        deps.bus.emit('memory:changed', { scope: 'quizzes', ids: [quiz.id] })
        deps.overlay.openQuiz(quiz.id)
        return
      }
      case 'insert_prompt':
        await deps.writer.write({ text: action.text, mode: 'insert', target: 'chat' })
        return
      case 'set_focus': {
        const settings = deps.settings.update({ focusSubjectId: action.subjectId })
        deps.bus.emit('settings:changed', { settings })
        return
      }
      case 'open_subject':
        await deps.surfaces.open('app', { route: APP_ROUTES.subject(action.subjectId) })
        return
      case 'adjust_roadmap':
        if (!deps.roadmapAdjust) throw new Error('Roadmap changes are not available here.')
        await deps.roadmapAdjust.run(action)
        return
      case 'add_note':
        if (!deps.notes) throw new Error('Notes are not available here.')
        deps.notes.save(action)
        return
      case 'undo_note':
        if (!deps.notes) throw new Error('Notes are not available here.')
        deps.notes.undo(action.noteId)
        return
      case 'give_feedback':
        if (!deps.feedback) throw new Error('Feedback is not available here.')
        deps.feedback.add({ scope: action.scope, subjectId: action.subjectId, text: action.text })
        return
      case 'save_question':
      case 'update_subject':
        if (!deps.saves) throw new Error('Saving is not available here.')
        deps.saves.apply(action)
        return
      case 'undo_save':
        if (!action.saveId) throw new Error('That has no Undo.')
        if (deps.saves?.undo(action.saveId)) return
        if (await deps.undoLog?.undo(action.saveId)) {
          deps.chatChanged?.()
          return
        }
        throw new Error('That can no longer be undone.')
      case 'run_tool':
        await this.runTool(action)
        return
    }
  }

  /** A chip the student pressed: runs the call confirmed and adds its receipt to the chat. */
  private async runTool(action: Extract<CoachAction, { type: 'run_tool' }>): Promise<void> {
    const { chatTools, chat } = this.deps
    if (!chatTools) throw new Error('That is not available here.')
    const out = await chatTools.run(action.tool, action.input, { confirmed: true })
    if (!out.ok) {
      const why = (out.result as { error?: unknown } | null)?.error
      throw new Error(typeof why === 'string' ? why : 'That did not work.')
    }
    const actions = [...out.chips, ...out.receipts.map(receiptAction)]
    if (chat && actions.length > 0) {
      chat.append({ thread: CHAT_THREAD, role: 'assistant', content: 'Done.', actions })
      this.deps.chatChanged?.()
    }
  }
}
