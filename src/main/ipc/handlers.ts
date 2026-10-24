/**
 * The handler for every `ipcInvoke` channel. Handlers only call services and shell flows; data
 * changes announce themselves on the bus (memory:changed / settings:changed), and the event
 * wiring turns those into window events. Overlay actions that start work (clicks) return at once
 * and run in the background, so the overlay never waits on the LLM.
 */
import type { Settings } from '@shared/domain'
import type { MemoryScope, OverlayAction } from '@shared/state'
import { buildExport, writeExport } from '../data/export'
import type { SecretKey } from '../services'
import type { ShellCore } from '../shell'
import type { Handlers, InvokeContext } from './types'

const KEY_FLAGS = {
  gemini: 'geminiKeySet',
  groq: 'groqKeySet',
  mistral: 'mistralKeySet',
} as const satisfies Record<SecretKey, keyof Settings['ai']>

export interface HandlerExtras {
  /** Opens System Settings directly when the helper cannot (e.g. it is not running). */
  openSystemSettings: (kind: 'accessibility' | 'screenRecording') => Promise<void>
  /** Overlay hover: make that display's overlay clickable (true) or click-through (false). */
  setOverlayInteractive: (displayId: number | null, interactive: boolean) => void
  /** The orb's right-click menu. */
  showOrbMenu: () => void
  setWindowSize: (surface: 'panel' | 'askbar', width: number, height: number) => void
  /** Folder for "Export everything" files (<data dir>/exports). */
  exportDir: string
  /** Shows a file in Finder. */
  revealFile: (path: string) => void
  /** "Delete everything": wipes the store, memory files and keys, then relaunches the app. */
  deleteAllData: () => Promise<void>
}

export function createHandlers(core: ShellCore, extras: HandlerExtras): Handlers {
  const { services, overlay, hooks } = core
  const { bus, repos, queries, study, quizzes, subjects, helper } = services
  const memory = (scope: MemoryScope, ids: (string | null)[]) =>
    bus.emit('memory:changed', { scope, ids: ids.filter((id): id is string => id !== null) })
  const settingsChanged = () => {
    const settings = repos.settings.get()
    bus.emit('settings:changed', { settings })
    return settings
  }
  const background = (label: string, work: () => Promise<unknown>) => {
    work().catch((error) => {
      console.error(`[shell] ${label} failed`, error)
      overlay.showToast({
        kind: 'error',
        title: 'Something went wrong',
        body: error instanceof Error ? error.message : String(error),
        ttlMs: 8000,
      })
    })
  }

  const overlayAction = (action: OverlayAction, ctx: InvokeContext): void => {
    const { router } = core
    switch (action.type) {
      case 'orbClick':
        background('orb click', () => router.orbClick())
        break
      case 'orbLongPress':
        background('orb long press', () => router.orbLongPress())
        break
      case 'timerClick':
        core.overlay.stopTimer()
        break
      case 'timerStart':
        core.overlay.startTimer(action.minutes)
        break
      case 'timerAdjust':
        core.overlay.adjustTimer(action.deltaMinutes)
        break
      case 'orbContextMenu':
        extras.showOrbMenu()
        break
      case 'orbDrag':
        overlay.dragOrb(ctx.displayId ?? overlay.state.displayId, action.x, action.y, action.done)
        break
      case 'pillClick':
        background('study pill', () => router.pillClick())
        break
      case 'chipClick':
        background('suggestion chip', () => router.chipClick())
        break
      case 'sideNext':
      case 'sideQuiz':
        background('next step', () => router.sideNext())
        break
      case 'toastAction':
        background('toast action', () => overlay.toasts.act(action.toastId, action.actionId))
        break
      case 'toastDismiss':
        overlay.toasts.dismiss(action.toastId)
        break
      case 'quizClose':
        overlay.closeQuiz()
        break
      case 'hover':
        overlay.hover(action.inside)
        extras.setOverlayInteractive(ctx.displayId, action.inside)
        break
    }
  }

  return {
    // App status & settings
    'app.getState': () => core.appState(),
    'settings.get': () => repos.settings.get(),
    'settings.update': (patch) => {
      repos.settings.update(patch)
      memory('settings', Object.keys(patch))
      return settingsChanged()
    },
    'secrets.set': ({ key, value }) => {
      services.secrets.set(key, value)
      const ai = repos.settings.get().ai
      repos.settings.update({ ai: { ...ai, [KEY_FLAGS[key]]: services.secrets.has(key) } })
      memory('settings', ['ai'])
      settingsChanged()
    },
    'profile.get': () => repos.profile.get(),
    'profile.update': (patch) => {
      const profile = repos.profile.update(patch)
      memory('profile', Object.keys(patch))
      return profile
    },
    'data.export': () => {
      const exportedAt = services.clock.nowIso()
      const data = buildExport(repos, { appVersion: hooks.version, exportedAt })
      const path = writeExport(extras.exportDir, data)
      extras.revealFile(path)
      return { path }
    },
    'data.deleteAll': () => extras.deleteAllData(),
    'capture.setEnabled': (enabled) => {
      repos.settings.update({ captureEnabled: enabled })
      services.perception.setEnabled(enabled)
      memory('settings', ['captureEnabled'])
      settingsChanged()
    },
    'permissions.status': () => core.permissions.refresh(),
    'permissions.open': async (kind) => {
      try {
        const { opened } = await helper.call('permissions.request', { kind })
        if (!opened) await extras.openSystemSettings(kind)
      } catch {
        await extras.openSystemSettings(kind)
      }
    },
    'providers.test': (id) => services.providers.test(id),
    'providers.usage': () => queries.usage(),

    // Read models
    'home.get': () => queries.home(),
    'subjects.list': () => queries.subjects(),
    'subjects.get': (id) => {
      bus.emit('subject:viewed', { subjectId: id }) // app subject page and panel topics
      return queries.subject(id)
    },
    'inbox.list': (filter) => queries.inbox(filter),
    'exams.list': () => queries.exams(),
    'search.query': (q) => queries.search(q),

    // Subjects, inbox, assignments
    'subjects.create': (input) => {
      const subject = subjects.create(input)
      memory('subjects', [subject.id])
      return subject
    },
    'subjects.update': ({ id, patch }) => {
      const subject = subjects.update(id, patch)
      memory('subjects', [id])
      return subject
    },
    'subjects.delete': ({ id }) => {
      subjects.remove(id)
      memory('subjects', [id])
      memory('inbox', [])
    },
    // Memory control: a note's change refreshes its subject (or the loose notes in the inbox).
    'subjects.tree': (id) => subjects.tree(id),
    'notes.loose': () => subjects.looseNotes(),
    'notes.update': ({ id, text }) => {
      const note = subjects.updateNote(id, text)
      if (note.subjectId) memory('subjects', [note.subjectId])
      else memory('inbox', [])
      return note
    },
    'notes.delete': (id) => {
      const note = subjects.deleteNote(id)
      if (note.subjectId) memory('subjects', [note.subjectId])
      else memory('inbox', [])
    },
    'notes.file': ({ id, subjectId, conceptId }) => {
      const note = subjects.fileNote(id, subjectId, conceptId)
      memory('subjects', [subjectId])
      memory('inbox', [])
      return note
    },
    'concepts.update': ({ id, name, summary }) => {
      const concept = subjects.updateConcept(id, { name, summary })
      memory('concepts', [id])
      return concept
    },
    'concepts.delete': (id) => {
      const concept = subjects.deleteConcept(id)
      memory('subjects', [concept.subjectId])
    },
    'encounters.delete': (id) => {
      const encounter = subjects.deleteEncounter(id)
      memory('subjects', [encounter.subjectId])
      memory('inbox', [id])
    },
    'suggested.act': ({ subjectId, action, intoId }) => {
      subjects.actSuggested(subjectId, action, intoId)
      memory('subjects', [subjectId, intoId])
    },
    'inbox.act': ({ encounterId, action, subjectId }) => {
      subjects.actInbox(encounterId, action, subjectId)
      memory('inbox', [encounterId])
    },
    'assignments.add': (input) => {
      const assignment = subjects.addAssignment(input)
      memory('assignments', [assignment.id])
      return assignment
    },

    // Study session
    'session.get': () => study.current(),
    'session.picker': () => study.picker(),
    'session.start': async (input) => {
      const { session } = await core.sessions.start(input)
      if (!session) throw new Error('The study session could not start')
      memory('roadmaps', [session.roadmapId])
      return session
    },
    'session.next': async () => (await core.sessions.next()).session,
    'session.end': () => {
      study.end()
    },

    // Quizzes & exams
    'quiz.get': (id) => quizzes.get(id),
    'quiz.answer': ({ quizId, questionId, chosenIndex }) =>
      quizzes.answer(quizId, questionId, chosenIndex),
    'quiz.finish': (id) => quizzes.finish(id),
    'exams.create': async (spec) => {
      const quiz = await quizzes.createExam(spec)
      memory('quizzes', [quiz.id])
      return quiz
    },

    // Coach chat, ask bar, actions
    'chat.history': (thread) => core.chat.history(thread),
    'chat.send': ({ thread, text }) => core.chat.send(thread, text),
    'coach.runAction': (action) => core.actions.run(action),
    'ask.submit': ({ text, since, subjectId }) => core.ask.submit(text, { since, subjectId }),
    'nudge.act': ({ nudgeId, action }) => core.nudges.act(nudgeId, action),

    // Prompts
    'prompt.copy': (text) => hooks.platform.writeClipboard(text),
    'prompt.sendToChat': async (text) => {
      const out = await core.writer.write({ text, mode: 'insert', target: 'chat' })
      return { ok: out.ok, reason: out.reason }
    },
    'prompt.write': ({ context }) => core.promptWriter.write(context),

    // Overlay & windows
    'overlay.getState': () => overlay.state,
    'overlay.action': (action, ctx) => overlayAction(action, ctx),
    'window.open': ({ surface, route }) => hooks.surfaces.open(surface, { route }),
    'window.close': (surface) => hooks.surfaces.close(surface),
    'window.setSize': ({ surface, width, height }) => extras.setWindowSize(surface, width, height),
  }
}
