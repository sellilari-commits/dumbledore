/**
 * Overlay controller: owns the OverlayState every overlay window renders.
 *
 * It listens to engine events (AI chat detected, focus changes, session, nudges, toasts,
 * thinking) and to the overlay's own actions (drag, hover), and keeps the orb's position: home
 * per display (settings.orb.home), latch/snap after a drag, docking beside the focused AI-chat
 * input with a return home 1.5 s after focus leaves, and the optional hide-into-edge. Pure TS —
 * no Electron — so it is unit-tested with FakeClock; the window layer subscribes to `onChange`.
 */
import type { Cancel, Clock } from '@engine/clock'
import type { PerceptionService, SettingsRepo, StudyService } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { Id, Nudge, Settings } from '@shared/domain'
import { type Rect, rectCenter } from '@shared/geometry'
import type { FocusedElement } from '@shared/helper-protocol'
import type { OutlineOverlay, OverlayState, SessionState, Toast } from '@shared/state'
import {
  canHideIntoEdge,
  type DisplayInfo,
  DOCKED_SIZE,
  defaultHome,
  displayAt,
  dockSpot,
  fitSpot,
  hiddenSpot,
  ORB_SIZE,
  type OrbSpot,
  primaryDisplay,
  snapToEdge,
  toGlobalPoint,
  toLocalPoint,
  toLocalRect,
} from './geometry'
import { chipPreview, coachActionLabel } from './labels'
import { clampTimerMinutes, FocusTimer, type TimerNotice } from './timer'
import { ToastCenter, type ToastPurpose, type ToastSpec } from './toasts'

export const RETURN_HOME_MS = 1500
export const HIDE_INTO_EDGE_MS = 1200
export const NUDGE_DOT_MS = 60 * 60 * 1000
/** The only boxes shown beside the orb: answers to an explicit gesture. */
const SHOWN_TOASTS: ReadonlySet<ToastPurpose> = new Set([
  'selection',
  'instruction-reply',
  'checkpoint-choice',
  'step-waiting',
])

export type NudgeChoice = 'accept' | 'dismiss' | 'snooze'

export interface OverlayControllerDeps {
  bus: EngineBus
  clock: Clock
  settings: Pick<SettingsRepo, 'get' | 'update'>
  study: Pick<StudyService, 'current' | 'picker'>
  perception: Pick<PerceptionService, 'aiChat'>
  onChange: (state: OverlayState) => void
  /** Text for the chip beside a docked, empty chat box (prefetched suggestion). */
  suggestionPreview?: () => Promise<string | null>
  /** A nudge toast button was pressed, or the toast was dismissed. */
  onNudge?: (nudgeId: Id, choice: NudgeChoice) => void
  /** An ignored nudge left the orange dot after an hour. */
  onNudgeExpired?: (nudgeId: Id) => void
  /** A system (macOS) notification, e.g. when the timer runs out. */
  notify?: (notice: TimerNotice) => void
}

interface Dock {
  displayId: number
  x: number
  y: number
  target: Rect
  ref: string | null
}

export class OverlayController {
  readonly toasts: ToastCenter
  readonly timer: FocusTimer
  private outline: OutlineOverlay | null = null
  private displays: DisplayInfo[] = []
  private home: OrbSpot | null = null
  private readonly homes = new Map<number, OrbSpot>()
  private drag: OrbSpot | null = null
  private dock: Dock | null = null
  private returnHome: Cancel | null = null
  private hovered = false
  private hidden = false
  private hideTimer: Cancel | null = null
  private timerMinutes: number
  private session: SessionState | null
  private aiChat: { provider: string } | null = null
  private pillCount = 0
  private chip: OverlayState['chip'] = null
  private quiz: { quizId: Id } | null = null
  private thinking = false
  private orb: Settings['orb']
  private captureEnabled: boolean
  private readonly collapsed = new Map<Id, Cancel>()
  private suggestSeq = 0
  private last = ''
  private readonly offs: (() => void)[] = []

  constructor(private readonly deps: OverlayControllerDeps) {
    this.toasts = new ToastCenter(deps.clock, () => this.update())
    this.timer = new FocusTimer(
      deps.clock,
      (notice) => deps.notify?.(notice),
      () => this.update(),
    )
    const settings = deps.settings.get()
    this.orb = settings.orb
    this.captureEnabled = settings.captureEnabled
    this.timerMinutes = settings.timerMinutes
    this.session = deps.study.current()
    const chat = deps.perception.aiChat()
    this.aiChat = chat ? { provider: chat.assistant } : null
    this.refreshPill()
  }

  start(): void {
    const { bus } = this.deps
    this.offs.push(
      bus.on('perception:aiChat', ({ chat }) => this.onAiChat(chat ? chat.assistant : null)),
      bus.on('helper:focus', ({ element }) => this.onFocus(element)),
      bus.on('session:changed', ({ session }) => this.onSession(session)),
      bus.on('nudge:ready', ({ nudge }) => this.showNudge(nudge)),
      bus.on('toast:show', ({ toast }) => this.showEngineToast(toast)),
      bus.on('thinking:changed', ({ busy }) => {
        this.thinking = busy
        this.update()
      }),
      bus.on('quiz:open', ({ quizId }) => this.openQuiz(quizId)),
      bus.on('settings:changed', ({ settings }) => this.onSettings(settings)),
    )
    this.update()
  }

  /** Outline marks over the page being read (null clears them). */
  setOutline(outline: OutlineOverlay | null): void {
    this.outline = outline
    this.update()
  }

  get outlineShown(): boolean {
    return this.outline !== null
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off()
    this.timer.dispose()
    this.returnHome?.()
    this.hideTimer?.()
    for (const cancel of this.collapsed.values()) cancel()
    this.collapsed.clear()
    this.toasts.clear()
  }

  get state(): OverlayState {
    return this.compute()
  }

  /** The orb's current spot (display-local), for placing the panel beside it. */
  anchor(): OrbSpot | null {
    if (this.drag) return this.drag
    if (this.dock)
      return { displayId: this.dock.displayId, x: this.dock.x, y: this.dock.y, edge: 'free' }
    return this.home
  }

  displayList(): DisplayInfo[] {
    return this.displays
  }

  setDisplays(displays: DisplayInfo[]): void {
    this.displays = displays
    const saved = this.orb.home
    const savedDisplay = saved ? displays.find((d) => d.id === saved.displayId) : undefined
    if (saved && savedDisplay) {
      this.home = fitSpot(savedDisplay, { ...saved, edge: 'free' })
    } else {
      const p = primaryDisplay(displays)
      const remembered = p ? this.homes.get(p.id) : undefined
      this.home = p ? (remembered ? fitSpot(p, remembered) : defaultHome(p)) : null
    }
    if (this.dock && !displays.some((d) => d.id === this.dock?.displayId)) this.undock()
    if (this.drag && !displays.some((d) => d.id === this.drag?.displayId)) this.drag = null
    this.update()
  }

  // ─── Overlay actions ────────────────────────────────────────────────────────────────────

  /** Pointer drag of the orb; x/y are in the coordinates of the overlay on `displayId`. */
  dragOrb(displayId: number, x: number, y: number, done: boolean): void {
    const from = this.displays.find((d) => d.id === displayId) ?? primaryDisplay(this.displays)
    if (!from) return
    const global = toGlobalPoint(from, { x, y })
    const target = displayAt(this.displays, global) ?? from
    const local = toLocalPoint(target, global)
    this.returnHome?.()
    this.returnHome = null
    this.dock = null
    this.chip = null
    this.hidden = false
    if (!done) {
      this.drag = { displayId: target.id, x: local.x, y: local.y, edge: 'free' }
      this.update()
      return
    }
    this.drag = null
    const spot = snapToEdge(target, local.x, local.y)
    this.home = spot
    this.homes.set(target.id, spot)
    this.orb = { ...this.orb, home: { displayId: target.id, x: spot.x, y: spot.y } }
    const settings = this.deps.settings.update({ orb: this.orb })
    this.deps.bus.emit('settings:changed', { settings })
    this.update()
  }

  /** The page reports whether the pointer is over one of its hit areas. */
  hover(inside: boolean): void {
    if (inside === this.hovered) return
    this.hovered = inside
    this.toasts.setPaused(inside)
    if (inside) {
      this.hideTimer?.()
      this.hideTimer = null
      if (this.hidden) this.hidden = false
    }
    this.update()
  }

  isHovered(): boolean {
    return this.hovered
  }

  openQuiz(quizId: Id): void {
    this.quiz = { quizId }
    this.update()
  }

  closeQuiz(): void {
    if (!this.quiz) return
    this.quiz = null
    this.update()
  }

  isQuizOpen(): boolean {
    return this.quiz !== null
  }

  showToast(spec: ToastSpec): string {
    return this.toast(spec)
  }

  /**
   * No pop-up boxes beside the orb (Ilari, 2026-10-25), except the ones that answer an explicit
   * gesture: the menu for selected text, the reply to a `/d …` instruction and the checkpoint's
   * "quiz or continue?" question. A nudge goes
   * straight to the orb's attention dot (still reachable from the panel); errors are logged. The
   * timer's macOS notification is separate and stays.
   */
  private toast(spec: ToastSpec): string {
    if (spec.purpose && SHOWN_TOASTS.has(spec.purpose)) return this.toasts.show(spec)
    if (spec.nudgeId) this.collapseNudge(spec.nudgeId)
    else if (spec.kind === 'error') console.warn('[overlay]', spec.title, spec.body)
    return ''
  }

  /** Removes one box (e.g. a stale question that was asked again). */
  removeToast(toastId: string): void {
    this.toasts.removeWhere((t) => t.id === toastId)
  }

  /** Removes a nudge from the toasts and the orange dot (after the user acted on it). */
  clearNudge(nudgeId: Id): void {
    this.collapsed.get(nudgeId)?.()
    this.collapsed.delete(nudgeId)
    this.toasts.removeWhere((t) => t.nudgeId === nudgeId)
    this.update()
  }

  // ─── Engine events ──────────────────────────────────────────────────────────────────────

  private onAiChat(provider: string | null): void {
    this.aiChat = provider ? { provider } : null
    if (!provider && this.dock) this.scheduleReturnHome()
    this.refreshPill()
    this.update()
  }

  private onSession(session: SessionState | null): void {
    this.session = session
    this.refreshPill()
    this.update()
  }

  /** The timer chooser picked a length: start it and remember it as the next default. */
  startTimer(minutes: number): void {
    const m = clampTimerMinutes(minutes)
    if (m !== this.timerMinutes) {
      this.timerMinutes = m
      const settings = this.deps.settings.update({ timerMinutes: m })
      this.deps.bus.emit('settings:changed', { settings })
    }
    this.timer.start(m)
  }

  /** The running timer's chooser (or a right click on the running square) stops it. */
  stopTimer(): void {
    this.timer.stop()
  }

  /** The running timer's chooser: add or take off minutes. The remembered length stays. */
  adjustTimer(deltaMinutes: number): void {
    this.timer.adjust(deltaMinutes)
  }

  private onSettings(settings: Settings): void {
    this.orb = settings.orb
    this.captureEnabled = settings.captureEnabled
    this.timerMinutes = settings.timerMinutes
    if (!settings.orb.followChatBoxes && this.dock) this.undock()
    if (!settings.orb.hideIntoEdge) this.hidden = false
    this.update()
  }

  private onFocus(element: FocusedElement | null): void {
    const chat = this.deps.perception.aiChat()
    const frame = element?.frame ?? null
    const dockable =
      this.orb.followChatBoxes &&
      chat !== null &&
      element?.editable === true &&
      !element.isSecure &&
      element.pid === chat.pid
    if (dockable && element && frame) this.dockTo(element, frame)
    else if (this.dock) this.scheduleReturnHome()
  }

  private dockTo(element: FocusedElement, frame: Rect): void {
    const display = displayAt(this.displays, rectCenter(frame))
    if (!display) return
    this.returnHome?.()
    this.returnHome = null
    const pos = dockSpot(display, frame)
    const sameField = element.ref !== null && this.dock?.ref === element.ref
    this.dock = {
      displayId: display.id,
      x: pos.x,
      y: pos.y,
      target: toLocalRect(display, frame),
      ref: element.ref,
    }
    this.hidden = false
    if ((element.valueLength ?? 0) > 0) {
      this.suggestSeq++
      this.chip = { kind: 'improve', text: 'Improve prompt' }
    } else if (!sameField || this.chip?.kind !== 'suggest') {
      this.chip = { kind: 'suggest', text: 'Suggest a prompt' }
      this.prefetchSuggestion()
    }
    this.update()
  }

  private prefetchSuggestion(): void {
    const preview = this.deps.suggestionPreview
    if (!preview) return
    const seq = ++this.suggestSeq
    preview()
      .then((text) => {
        if (seq !== this.suggestSeq || !this.dock || this.chip?.kind !== 'suggest' || !text) return
        this.chip = { kind: 'suggest', text: chipPreview(text) }
        this.update()
      })
      .catch(() => undefined)
  }

  private scheduleReturnHome(): void {
    if (this.returnHome) return
    this.returnHome = this.deps.clock.setTimeout(() => {
      this.returnHome = null
      this.undock()
    }, RETURN_HOME_MS)
  }

  private undock(): void {
    this.returnHome?.()
    this.returnHome = null
    this.dock = null
    this.chip = null
    this.suggestSeq++
    this.update()
  }

  private refreshPill(): void {
    if (!this.aiChat || this.sessionActive()) {
      this.pillCount = 0
      return
    }
    try {
      this.pillCount = this.deps.study.picker().subjects.reduce((n, s) => n + s.questions.length, 0)
    } catch {
      this.pillCount = 0
    }
  }

  private showNudge(nudge: Nudge): void {
    const onNudge = this.deps.onNudge
    this.toast({
      kind: 'nudge',
      title: nudge.title,
      body: nudge.body,
      nudgeId: nudge.id,
      actions: [
        ...(nudge.action
          ? [
              {
                id: 'accept',
                label: coachActionLabel(nudge.action),
                primary: true,
                run: () => onNudge?.(nudge.id, 'accept'),
              },
            ]
          : []),
        { id: 'snooze', label: 'Later', run: () => onNudge?.(nudge.id, 'snooze') },
      ],
      onExpire: () => this.collapseNudge(nudge.id),
      onDismiss: () => onNudge?.(nudge.id, 'dismiss'),
    })
  }

  private showEngineToast(toast: Toast): void {
    const nudgeId = toast.nudgeId
    const onNudge = this.deps.onNudge
    this.toast({
      kind: toast.kind,
      title: toast.title,
      body: toast.body,
      ttlMs: toast.ttlMs,
      nudgeId,
      actions: toast.actions.map((a) => ({
        ...a,
        run: nudgeId ? () => onNudge?.(nudgeId, a.primary ? 'accept' : 'dismiss') : undefined,
      })),
      onExpire: nudgeId ? () => this.collapseNudge(nudgeId) : undefined,
    })
  }

  private collapseNudge(nudgeId: Id): void {
    this.collapsed.get(nudgeId)?.()
    const cancel = this.deps.clock.setTimeout(() => {
      this.collapsed.delete(nudgeId)
      this.deps.onNudgeExpired?.(nudgeId)
      this.update()
    }, NUDGE_DOT_MS)
    this.collapsed.set(nudgeId, cancel)
    this.update()
  }

  // ─── State ──────────────────────────────────────────────────────────────────────────────

  private sessionActive(): boolean {
    const phase = this.session?.phase
    return phase === 'step' || phase === 'checkpoint' || phase === 'planning'
  }

  private canHide(): boolean {
    return (
      this.orb.hideIntoEdge &&
      !this.hovered &&
      !this.drag &&
      !this.dock &&
      !this.quiz &&
      !this.thinking &&
      !this.aiChat &&
      !this.sessionActive() &&
      this.toasts.list().length === 0 &&
      this.home !== null &&
      canHideIntoEdge(this.home.edge)
    )
  }

  private update(): void {
    if (this.hidden && !this.canHide()) this.hidden = false
    const state = this.compute()
    const json = JSON.stringify(state)
    if (json !== this.last) {
      this.last = json
      this.deps.onChange(state)
    }
    this.armHide()
  }

  private armHide(): void {
    if (this.hidden || this.hideTimer || !this.canHide()) return
    this.hideTimer = this.deps.clock.setTimeout(() => {
      this.hideTimer = null
      if (!this.canHide()) return
      this.hidden = true
      this.update()
    }, HIDE_INTO_EDGE_MS)
  }

  private compute(): OverlayState {
    const docked = !this.drag && this.dock !== null
    const fallback: OrbSpot = { displayId: 0, x: 0, y: 0, edge: 'right' }
    const spot: OrbSpot =
      this.drag ??
      (this.dock
        ? { displayId: this.dock.displayId, x: this.dock.x, y: this.dock.y, edge: 'free' }
        : (this.home ?? fallback))
    const display = this.displays.find((d) => d.id === spot.displayId)
    const pos = this.hidden && display && this.home ? hiddenSpot(display, this.home) : spot
    const s = this.session
    const active = this.sessionActive()
    const dot = this.collapsed.size > 0 ? 'orange' : 'none'
    const paused = !this.captureEnabled
    return {
      displayId: spot.displayId,
      orb: {
        x: pos.x,
        y: pos.y,
        size: docked ? DOCKED_SIZE : ORB_SIZE,
        visual: this.thinking
          ? 'thinking'
          : docked
            ? 'docked'
            : active
              ? 'session'
              : dot !== 'none'
                ? 'attention'
                : paused
                  ? 'paused'
                  : 'idle',
        thinking: this.thinking,
        progress:
          active && s ? { k: s.items.filter((i) => i.status === 'done').length, n: s.total } : null,
        dot,
        paused,
        docked,
      },
      dockTarget: docked && this.dock ? this.dock.target : null,
      edge: this.drag || docked ? 'free' : (this.home?.edge ?? 'right'),
      pill: this.aiChat && !active ? { label: 'Study', count: this.pillCount } : null,
      side: active && s ? sideStack(s) : { next: null, quiz: false },
      chip: docked ? this.chip : null,
      toasts: this.toasts.list(),
      quiz: this.quiz,
      aiChat: this.aiChat,
      timer: this.timer.state,
      timerMinutes: this.timerMinutes,
      outline: this.outline,
    }
  }
}

function sideStack(s: SessionState): OverlayState['side'] {
  switch (s.nextAction) {
    case 'paste_next':
      return { next: { label: `${Math.min(s.index + 2, s.total)}/${s.total}` }, quiz: false }
    case 'open_quiz':
      return { next: null, quiz: true }
    case 'finish':
      return { next: { label: 'Finish' }, quiz: false }
    default:
      return { next: null, quiz: false }
  }
}
