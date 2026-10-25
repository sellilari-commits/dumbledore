/**
 * Runs a CoachAction (from chat replies, ask-bar chips, nudges, toasts): start a roadmap, create
 * an exam and open it in the app, start a review quiz in the overlay, insert a prompt into the
 * chat, set the focus subject, open a subject page, replan a subject's roadmap from the
 * student's own words (adjust_roadmap, never pasted), save or undo a typed note, save what the
 * student asked or a course fact (ChatSaves) or undo it, or store feedback for the prompts of its
 * scope.
 */
import type { FeedbackRepo, QuizService, SettingsRepo } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { CoachAction } from '@shared/domain'
import { APP_ROUTES } from '@shared/state'
import type { ChatWriter } from '../chat/chat-writer'
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
}

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
        if (!deps.saves?.undo(action.saveId)) throw new Error('That can no longer be undone.')
        return
    }
  }
}
