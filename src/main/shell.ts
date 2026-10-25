/**
 * The shell's object graph without Electron: overlay controller, focus hand-back, ChatWriter,
 * flows and the shortcut router, wired to the engine bus. app.ts supplies the Electron platform,
 * the window manager (SurfaceControl) and the broadcast hooks; tests supply fakes.
 */

import type { AssistantConfig } from '@engine/perception/ai-chat/assistants'
import { detectAssistant } from '@engine/perception/ai-chat/detector'
import { usualAssistantFrom } from '@engine/perception/ai-chat/usual'
import { blockReason, excludedBundleIds } from '@engine/privacy'
import type { RelinkSupport } from '@engine/store/sqlite-repos'
import type { EventPayload, InvokeChannel } from '@shared/ipc'
import type { AppState, OverlayState } from '@shared/state'
import { ChatWriter } from './chat/chat-writer'
import { FocusKeeper } from './chat/focus-keeper'
import { type ChatTools, createChatTools } from './chat-tools'
import { createChatFlows } from './chat-tools/flows'
import { UndoLog } from './chat-tools/undo'
import { createWebSearchTool } from './chat-tools/web-search'
import { buildAppState, PermissionsCache } from './flows/app-state'
import { AskFlow } from './flows/ask-flow'
import { ChatMemory } from './flows/chat-memory'
import { ChatSaves } from './flows/chat-saves'
import { CoachActions } from './flows/coach-actions'
import { CoachChat } from './flows/coach-chat'
import { chatContext, coachContextText } from './flows/context'
import { NudgeActions } from './flows/nudges'
import { OutlineFlow } from './flows/outline-flow'
import { PromptWriter } from './flows/prompt-writer'
import { RoadmapAdjust } from './flows/roadmap-adjust'
import { SessionFlow } from './flows/session-flow'
import { Thinking } from './flows/thinking'
import { TypedNotes } from './flows/typed-notes'
import { runHandler } from './ipc/register'
import type { Handlers } from './ipc/types'
import { OverlayController } from './overlay/controller'
import type { ShellPlatform, SurfaceControl } from './platform'
import { lastStudiedSubject, tapTarget } from './router/last-subject'
import { PendingWork } from './router/pending'
import { ShortcutRouter } from './router/shortcut-router'
import { SuggestionCache } from './router/suggestions'
import type { Services } from './services'

export interface ShellHooks {
  platform: ShellPlatform
  surfaces: SurfaceControl
  version: string
  onOverlayChange: (state: OverlayState) => void
  onChatDelta: (delta: EventPayload<'chat.delta'>) => void
  /** The chat's current step while a reply is on its way (the Ask bar's working indicator). */
  onChatProgress?: (progress: EventPayload<'chat.progress'>) => void
  /** Shortcut work started or finished (the shell registers Esc while busy). */
  onBusy: (busy: boolean) => void
  /** Something AppState depends on changed. */
  onAppStateChange: () => void
  /** A system (macOS) notification, e.g. when the timer under the orb runs out. */
  notify?: (notice: { title: string; body: string }) => void
}

export interface ShellCore {
  services: Services
  hooks: ShellHooks
  overlay: OverlayController
  focus: FocusKeeper
  writer: ChatWriter
  thinking: Thinking
  sessions: SessionFlow
  ask: AskFlow
  /** The double-tap chat's tools (read, search, create, update, delete, act, web_search). */
  chatTools: ChatTools
  /** Late binding: the IPC handlers are built after the core (app acts, "Open <AI> and paste"). */
  bindHandlers(handlers: Handlers): void
  /** The prompt box (right ⌥ hold): writes a prompt from what the student asked for. */
  promptWriter: PromptWriter
  chat: CoachChat
  actions: CoachActions
  nudges: NudgeActions
  router: ShortcutRouter
  pending: PendingWork
  suggestions: SuggestionCache
  permissions: PermissionsCache
  appState(): AppState
  start(): void
  dispose(): void
}

/** SqliteRepos.relink (moving a topic to another subject), as the subject service finds it. */
function relinkOf(repos: Services['repos']): RelinkSupport | null {
  const candidate = (repos as Services['repos'] & { relink?: RelinkSupport }).relink
  return candidate && typeof candidate.moveConcept === 'function' ? candidate : null
}

export function createShellCore(services: Services, hooks: ShellHooks): ShellCore {
  const { bus, clock, repos, helper, study, perception } = services
  const { platform, surfaces } = hooks
  const thinking = new Thinking(bus)
  const pending = new PendingWork(hooks.onBusy)
  const focus = new FocusKeeper(helper, platform)
  const contextText = () =>
    coachContextText({
      repos,
      queries: services.queries,
      study,
      perception,
      nowIso: () => clock.nowIso(),
    })
  // AppState is rebuilt on every change; the usual AI (a scan of recent captures) is kept a minute.
  let usual: { at: number; value: AssistantConfig | null } | null = null
  const usualAssistant = () => {
    const now = clock.now()
    if (!usual || now - usual.at > 60_000)
      usual = { at: now, value: usualAssistantFrom(repos, now) }
    return usual.value
  }
  const suggestions = new SuggestionCache(
    services.prompts,
    () => chatContext(perception),
    () => {
      const s = study.current()
      return `${perception.aiChat()?.pid ?? '-'}|${s?.roadmapId ?? '-'}|${s?.index ?? '-'}`
    },
    clock,
  )
  // The overlay and the flows reference each other through these late-bound holders.
  let nudges: NudgeActions | null = null
  const overlay = new OverlayController({
    bus,
    clock,
    settings: repos.settings,
    study,
    perception,
    onChange: hooks.onOverlayChange,
    suggestionPreview: async () => (await suggestions.get()).prompt,
    onNudge: (id, choice) => void nudges?.act(id, choice),
    onNudgeExpired: (id) => nudges?.expired(id),
    notify: (notice) => hooks.notify?.(notice),
  })
  const writer = new ChatWriter({
    helper,
    focus,
    platform,
    perception,
    notify: (toast) => overlay.showToast(toast),
  })
  const sessions = new SessionFlow({
    study,
    perception,
    followUps: services.followUps,
    writer,
    thinking,
    surfaces,
    overlay,
  })
  const typedNotes = new TypedNotes({ repos, bus })
  // What the double-tap chat hears goes into the student's studying, with receipts and Undo.
  const chatSaves = new ChatSaves({ repos, bus, notes: typedNotes })
  // The double-tap chat's tools: everything Dumbledore knows, with receipts and Undo. App acts and
  // "Open <AI> and paste" go through the IPC handlers, bound once app.ts has built them.
  let handlers: Handlers | null = null
  const invoke = async (channel: InvokeChannel, payload: unknown): Promise<unknown> => {
    if (!handlers) throw new Error('App actions are not ready yet.')
    return runHandler(channel, handlers, payload, { surface: 'askbar', displayId: null })
  }
  const undoLog = new UndoLog()
  const chatChanged = () => bus.emit('memory:changed', { scope: 'chat', ids: [] })
  const chatFlows = createChatFlows({
    repos,
    bus,
    nowIso: () => clock.nowIso(),
    undo: undoLog,
    saves: chatSaves,
    notes: typedNotes,
    // CoachActions and AskFlow are built below; these run only once a chat turn calls them.
    run: (action) => actions.run(action),
    plan: (action, opts) => ask.plan(action, opts),
    prompts: services.prompts,
    perception,
    writer,
    sessions,
    surfaces,
    openUsualAi: async (text) => {
      const res = (await invoke('prompt.openUsualAi', text)) as {
        opened: { name: string; prefilled: boolean } | null
      }
      return res.opened
    },
    copy: async (text) => platform.writeClipboard(text),
    subjectName: () => {
      const id = lastStudiedSubject(repos) ?? repos.settings.get().focusSubjectId
      return id ? (repos.subjects.get(id)?.name ?? null) : null
    },
  })
  const brain = services.brain
  const chatTools = createChatTools({
    repos,
    queries: services.queries,
    memory: services.subjects,
    study,
    bus,
    undo: undoLog,
    relink: relinkOf(repos),
    nowIso: () => clock.nowIso(),
    perform: chatFlows.perform,
    flows: chatFlows.flows,
    refuse: chatFlows.refuse,
    invoke,
    webSearch: brain.webSearch
      ? createWebSearchTool({
          search: (query, signal) =>
            brain.webSearch ? brain.webSearch(query, { signal }) : Promise.resolve('no-key'),
        })
      : null,
    log: (line) => console.info(line),
  })
  // A pressed Undo is noted in the chat memory, so the next turns know it was undone.
  const undoNotes = new ChatMemory({ chat: repos.chat })
  const actions = new CoachActions({
    undoLog: { undo: async (id) => undoNotes.noteUndo(id, await undoLog.undo(id)) },
    chatChanged,
    notes: typedNotes,
    saves: {
      apply: (action) => chatSaves.apply(action),
      undo: (id) => undoNotes.noteUndo(id, chatSaves.undo(id)),
    },
    feedback: repos.feedback,
    sessions,
    quizzes: services.quizzes,
    settings: repos.settings,
    bus,
    writer,
    surfaces,
    overlay,
    roadmapAdjust: new RoadmapAdjust({
      study,
      repos,
      brain: services.brain,
      perception,
      thinking,
      bus,
    }),
  })
  const runAction = (action: Parameters<CoachActions['run']>[0]) => actions.run(action)
  sessions.bindActions(runAction)
  nudges = new NudgeActions({
    repos,
    clock,
    bus,
    runAction,
    clearFromOverlay: (id) => overlay.clearNudge(id),
  })
  const ask = new AskFlow({
    brain: services.brain,
    repos,
    perception,
    sessions,
    writer,
    thinking,
    overlay,
    contextText,
    runAction,
    emitDelta: hooks.onChatDelta,
    emitProgress: hooks.onChatProgress,
    feedback: repos.feedback,
    saves: chatSaves,
    assistantName: () => perception.aiChat()?.assistant ?? usualAssistant()?.name ?? null,
    chatChanged,
    chatTools,
  })
  const promptWriter = new PromptWriter({ sessions, study, perception, surfaces, thinking })
  const chat = new CoachChat({
    brain: services.brain,
    repos,
    bus,
    thinking,
    contextText,
    emitDelta: hooks.onChatDelta,
  })
  // Outline (right ⌥ hold on an article, a PDF or an AI chat's answers): the lines with their
  // boxes, read fresh and never from an excluded app or site, marked for its subject and saved to it.
  const outlineFlow = new OutlineFlow({
    repos,
    frontWindow: async () => {
      const settings = repos.settings.get()
      const res = await helper.call('perceive', {
        scope: 'frontmost',
        fresh: true,
        excludeBundleIds: excludedBundleIds(settings),
        allowOcr: settings.ocrEnabled,
      })
      const win = res.windows[0] ?? null
      if (!win) return null
      return blockReason(win, win.url, win.title, settings) ? 'private' : win
    },
    subjectFor: () => perception.now()?.subjectId ?? tapTarget(repos)?.subjectId ?? null,
    isAiChat: (win) =>
      detectAssistant({ bundleId: win.bundleId ?? '', title: win.title, url: win.url }) !== null,
    outline: (input, opts) => services.brain.outline(input, opts),
    show: (outline) => overlay.setOutline(outline),
    changed: (subjectId) => bus.emit('memory:changed', { scope: 'subjects', ids: [subjectId] }),
  })
  const router = new ShortcutRouter({
    helper,
    ownPid: platform.ownPid,
    repos,
    study,
    perception,
    prompts: services.prompts,
    quizzes: services.quizzes,
    suggestions,
    surfaces,
    overlay,
    sessions,
    ask,
    writer,
    thinking,
    pending,
    outline: {
      shown: () => overlay.outlineShown,
      run: (signal) => outlineFlow.run(signal),
      clear: () => outlineFlow.clear(),
    },
  })
  const permissions = new PermissionsCache(helper, clock, hooks.onAppStateChange)
  const offs: (() => void)[] = []

  // Screen Recording must stay on (OCR of PDFs, slides, video): remind once per launch.
  let screenRecordingReminded = false
  const remindScreenRecording = (screenRecording: boolean) => {
    if (screenRecording || screenRecordingReminded || helper.status !== 'connected') return
    screenRecordingReminded = true
    overlay.showToast({
      kind: 'info',
      title: 'Screen Recording is off',
      body: "Dumbledore can't read PDFs, slides or video until you allow it.",
      actions: [
        {
          id: 'allow',
          label: 'Turn on',
          primary: true,
          run: () => surfaces.open('app', { route: '/settings/capture' }),
        },
        { id: 'later', label: 'Later' },
      ],
      ttlMs: 30_000,
    })
  }

  const configureShortcut = () => {
    if (helper.status !== 'connected') return
    const { fallbackChord: _chord, ...timing } = repos.settings.get().shortcut
    helper.call('shortcut.configure', { ...timing, enabled: true }).catch(() => undefined)
  }

  const core: ShellCore = {
    services,
    hooks,
    overlay,
    focus,
    writer,
    thinking,
    sessions,
    ask,
    chatTools,
    bindHandlers(bound) {
      handlers = bound
    },
    promptWriter,
    chat,
    actions,
    nudges,
    router,
    pending,
    suggestions,
    permissions,
    appState: () =>
      buildAppState({
        settings: repos.settings,
        perception,
        helper,
        providers: services.providers,
        permissions,
        usualAssistant,
        version: hooks.version,
      }),
    start() {
      offs.push(
        bus.on('helper:key', ({ gesture, secureInput }) => {
          // Onboarding teaches the key from 'key.gesture' itself; don't also run the action.
          // With its window closed, the key brings onboarding back instead of doing nothing.
          if (!repos.settings.get().onboardingDone) {
            if (!surfaces.isOpen('app')) void surfaces.open('app')
            return
          }
          router.gesture(gesture, { secureInput }).catch((error) => {
            console.error('[router] gesture failed', error)
            overlay.showToast({
              kind: 'error',
              title: 'Something went wrong',
              body: error instanceof Error ? error.message : String(error),
              ttlMs: 8000,
            })
          })
        }),
        bus.on('nudge:ready', ({ nudge }) => nudges?.shown(nudge)),
        bus.on('settings:changed', ({ settings }) => {
          perception.setEnabled(settings.captureEnabled)
          configureShortcut()
          hooks.onAppStateChange()
        }),
        bus.on('helper:status', ({ status }) => {
          if (status === 'connected') {
            configureShortcut()
            void permissions.refresh().then((p) => remindScreenRecording(p.screenRecording))
          }
          hooks.onAppStateChange()
        }),
        bus.on('perception:now', () => hooks.onAppStateChange()),
        bus.on('perception:aiChat', () => {
          suggestions.invalidate()
          hooks.onAppStateChange()
        }),
        bus.on('session:changed', () => suggestions.invalidate()),
      )
      overlay.start()
      permissions.start()
      configureShortcut()
    },
    dispose() {
      for (const off of offs.splice(0)) off()
      permissions.stop()
      overlay.dispose()
      pending.cancel()
    },
  }
  return core
}
