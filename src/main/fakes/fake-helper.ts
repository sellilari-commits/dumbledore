/**
 * In-process stand-in for the Swift helper (lane L1) used in development, unit tests and the
 * E2E-sim test-control channel.
 *
 * Every call is validated against the helper protocol (params in, result out), so the shell is
 * exercised with contract-valid shapes. Behaviour is driven by a mutable `state`; tests can also
 * override single methods with `respond()`. It cannot type into other apps: by default
 * `input.write` fails, which makes the shell fall back to "Copied — press ⌘V".
 */
import type { HelperClient, HelperStatus } from '@engine/contracts'
import {
  type AppRef,
  type Display,
  type FocusedElement,
  type FrontmostInfo,
  type HelperEvent,
  type HelperEventPayload,
  type HelperMethod,
  type HelperParams,
  type HelperResult,
  helperEvents,
  helperMethods,
  type PermissionsSnapshot,
} from '@shared/helper-protocol'
import type { z } from 'zod'

export interface FakeHelperState {
  permissions: PermissionsSnapshot
  frontmost: FrontmostInfo | null
  focused: FocusedElement | null
  fieldValue: string | null
  selection: string | null
  /** Result of ax.findChatInput when the focused element is not an editable field of that pid. */
  chatInput: HelperResult<'ax.findChatInput'>
  /** Result of input.write when the frontmost pid matches `expectPid`. */
  writeResult: HelperResult<'input.write'>
  displays: Display[]
  idleSeconds: number
  /** Apps `app.activate` can switch to, by pid. */
  apps: Map<number, FrontmostInfo>
}

type Listener = (payload: unknown) => void
type Override = (params: unknown) => unknown
/** Params after protocol parsing (defaults applied). */
export type ParsedParams<M extends HelperMethod> = z.output<(typeof helperMethods)[M]['params']>

export function makeFrontmost(app: AppRef, extra: Partial<FrontmostInfo> = {}): FrontmostInfo {
  return {
    ...app,
    windowId: null,
    windowTitle: null,
    windowFrame: null,
    isFullScreen: false,
    url: null,
    ...extra,
  }
}

export function makeFocused(app: AppRef, extra: Partial<FocusedElement> = {}): FocusedElement {
  return {
    ...app,
    role: 'AXTextArea',
    subrole: null,
    editable: true,
    isSecure: false,
    frame: null,
    caret: null,
    placeholder: null,
    valueLength: 0,
    ref: `ax-${app.pid}-1`,
    ...extra,
  }
}

const NO_WRITE: HelperResult<'input.write'> = {
  ok: false,
  method: null,
  verified: false,
  reason: 'The development helper cannot type into other apps',
}

export class FakeHelperClient implements HelperClient {
  status: HelperStatus = 'down'
  readonly calls: { method: HelperMethod; params: unknown }[] = []
  readonly state: FakeHelperState
  private readonly overrides = new Map<HelperMethod, Override>()
  private readonly listeners = new Map<HelperEvent, Set<Listener>>()
  private readonly statusListeners = new Set<(status: HelperStatus) => void>()

  constructor(initial: Partial<FakeHelperState> = {}) {
    this.state = {
      permissions: { accessibility: true, screenRecording: false },
      frontmost: null,
      focused: null,
      fieldValue: null,
      selection: null,
      chatInput: { found: false, frame: null, ref: null, method: null },
      writeResult: NO_WRITE,
      displays: [],
      idleSeconds: 0,
      apps: new Map(),
      ...initial,
    }
  }

  async start(): Promise<void> {
    this.setStatus('connected')
  }

  async stop(): Promise<void> {
    this.setStatus('down')
  }

  setStatus(status: HelperStatus): void {
    if (status === this.status) return
    this.status = status
    for (const listener of [...this.statusListeners]) listener(status)
  }

  /** Overrides one method; the function receives parsed params (defaults applied). */
  respond<M extends HelperMethod>(
    method: M,
    fn: (params: ParsedParams<M>) => HelperResult<M> | Promise<HelperResult<M>>,
  ): void {
    this.overrides.set(method, fn as Override)
  }

  callsTo(method: HelperMethod): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params)
  }

  async call<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    _opts?: { timeoutMs?: number },
  ): Promise<HelperResult<M>> {
    const spec = helperMethods[method]
    const parsed: unknown = spec.params.parse(params)
    this.calls.push({ method, params: parsed })
    if (this.status !== 'connected') throw new Error(`helper is ${this.status}`)
    const override = this.overrides.get(method)
    const raw = override ? await override(parsed) : this.defaultResult(method, parsed)
    return spec.result.parse(raw) as HelperResult<M>
  }

  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
    return () => {
      set?.delete(listener as Listener)
    }
  }

  onStatus(listener: (status: HelperStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /** Emits a helper notification (validated against the protocol). */
  emit<E extends HelperEvent>(event: E, payload: HelperEventPayload<E>): void {
    const parsed: unknown = helperEvents[event].parse(payload)
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(parsed)
  }

  /** Makes `app` frontmost (registering it for app.activate) and emits app.activated. */
  activateApp(app: FrontmostInfo): void {
    this.state.apps.set(app.pid, app)
    this.state.frontmost = app
    this.emit('app.activated', { pid: app.pid, bundleId: app.bundleId, appName: app.appName })
  }

  /** Moves keyboard focus to `element` (null = nothing focused) and emits focus.changed. */
  focus(element: FocusedElement | null, value: string | null = null): void {
    this.state.focused = element
    this.state.fieldValue = value
    const front = this.state.frontmost
    const app = element
      ? { pid: element.pid, bundleId: element.bundleId, appName: element.appName }
      : front
        ? { pid: front.pid, bundleId: front.bundleId, appName: front.appName }
        : null
    this.emit('focus.changed', { app, element })
  }

  private defaultResult(method: HelperMethod, params: unknown): unknown {
    const s = this.state
    switch (method) {
      case 'ping':
        return { version: 1, pid: 0, permissions: s.permissions }
      case 'permissions.status':
        return s.permissions
      case 'permissions.request':
        return { opened: true }
      case 'frontmost':
        return s.frontmost
      case 'perceive':
        return { windows: [] }
      case 'ax.focused':
        return s.focused
      case 'ax.readFocusedValue':
        return { text: s.focused?.isSecure ? null : s.fieldValue }
      case 'ax.selectedText':
        return { text: s.selection }
      case 'ax.findChatInput':
        return this.findChatInput(params as ParsedParams<'ax.findChatInput'>)
      case 'input.write':
        return this.write(params as ParsedParams<'input.write'>)
      case 'input.click':
      case 'input.key':
        return { ok: true }
      case 'app.activate':
        return this.activate((params as { pid: number }).pid)
      case 'system.idle':
        return { seconds: s.idleSeconds }
      case 'system.displays':
        return { displays: s.displays }
      case 'shortcut.configure':
        return { ok: true }
      case 'llm.onDevice.status':
        return { available: false, reason: 'fakeHelper', contextSize: null }
      case 'llm.onDevice.generate':
        throw new Error('The on-device model is not available in the fake helper')
    }
  }

  private findChatInput(params: ParsedParams<'ax.findChatInput'>): unknown {
    const f = this.state.focused
    if (f?.editable && !f.isSecure && (params.pid == null || f.pid === params.pid)) {
      return { found: true, frame: f.frame, ref: f.ref, method: 'focused' }
    }
    return this.state.chatInput
  }

  private write(params: ParsedParams<'input.write'>): unknown {
    const front = this.state.frontmost
    if (params.expectPid != null && front?.pid !== params.expectPid) {
      return { ok: false, method: null, verified: false, reason: 'Frontmost app changed' }
    }
    const result = this.state.writeResult
    if (result.ok) {
      const current = this.state.fieldValue ?? ''
      this.state.fieldValue = params.mode === 'replaceAll' ? params.text : current + params.text
    }
    return result
  }

  private activate(pid: number): unknown {
    const app = this.state.apps.get(pid)
    if (!app) return { ok: false }
    this.activateApp(app)
    return { ok: true }
  }
}
