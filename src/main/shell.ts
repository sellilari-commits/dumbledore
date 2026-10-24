/**
 * The shell's object graph without Electron: overlay controller, focus hand-back, ChatWriter,
 * flows and the shortcut router, wired to the engine bus. app.ts supplies the Electron platform,
 * the window manager (SurfaceControl) and the broadcast hooks; tests supply fakes.
 */
import type { EventPayload } from '@shared/ipc'
import type { AppState, OverlayState } from '@shared/state'
import { ChatWriter } from './chat/chat-writer'
import { FocusKeeper } from './chat/focus-keeper'
import { buildAppState, PermissionsCache } from './flows/app-state'
import { AskFlow } from './flows/ask-flow'
import { CoachActions } from './flows/coach-actions'
import { CoachChat } from './flows/coach-chat'
import { chatContext, coachContextText } from './flows/context'
import { NudgeActions } from './flows/nudges'
import { PromptWriter } from './flows/prompt-writer'
import { RoadmapAdjust } from './flows/roadmap-adjust'
import { SessionFlow } from './flows/session-flow'
import { Thinking } from './flows/thinking'
import { OverlayController } from './overlay/controller'
import type { ShellPlatform, SurfaceControl } from './platform'
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
  const actions = new CoachActions({
    sessions,
    quizzes: services.quizzes,
    settings: repos.settings,
    bus,
    writer,
    surfaces,
    overlay,
    roadmapAdjust: new RoadmapAdjust({ study, repos, perception, thinking, bus }),
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
        version: hooks.version,
      }),
    start() {
      offs.push(
        bus.on('helper:key', ({ gesture, secureInput }) => {
          // Onboarding teaches the key from 'key.gesture' itself; don't also run the action.
          if (!repos.settings.get().onboardingDone) return
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
