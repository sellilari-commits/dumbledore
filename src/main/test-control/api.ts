/**
 * Adapts the shell to the test-control endpoints: validates every request body with zod, runs
 * gestures through the real router, overlay actions and invokes through the real IPC handlers,
 * and (while fakes are in use) lets E2E tests drive the fake helper and perception.
 */
import {
  FocusedElement,
  FrontmostInfo,
  Gesture,
  type HelperEvent,
  helperEvents,
  helperMethods,
} from '@shared/helper-protocol'
import { type InvokeChannel, ipcInvoke } from '@shared/ipc'
import { NowContext, OverlayAction } from '@shared/state'
import { z } from 'zod'
import type { Composition } from '../compose'
import { runHandler } from '../ipc/register'
import type { Handlers } from '../ipc/types'
import type { ShellCore } from '../shell'
import type { QuizKey } from '../shortcuts'
import type { TestControlApi } from './server'

export interface TestControlDeps {
  core: ShellCore
  handlers: Handlers
  fakes: Composition['fakes']
  windows: () => unknown
  /** What the global quiz-card keys do: inject the key into the overlay pages. */
  forwardKey: (key: QuizKey) => void
}

const GestureBody = z.object({ gesture: Gesture, secureInput: z.boolean().optional() })
const ActionBody = z.object({
  action: OverlayAction,
  displayId: z.number().int().nullable().optional(),
})
const InvokeBody = z.object({ channel: z.string(), payload: z.unknown().optional() })
const KeyBody = z.object({ key: z.enum(['1', '2', '3', '4', 'Return', 'Escape']) })
const HelperEventBody = z.object({
  event: z.enum(Object.keys(helperEvents) as [HelperEvent, ...HelperEvent[]]),
  payload: z.unknown(),
})
const HelperStateBody = z
  .object({
    frontmost: FrontmostInfo.nullable(),
    focused: FocusedElement.nullable(),
    fieldValue: z.string().nullable(),
    selection: z.string().nullable(),
    writeResult: helperMethods['input.write'].result,
    chatInput: helperMethods['ax.findChatInput'].result,
    apps: z.array(FrontmostInfo),
    /** Emit focus.changed for `focused` after applying the state. */
    emitFocus: z.boolean(),
    /** Emit app.activated for `frontmost` after applying the state. */
    emitActivated: z.boolean(),
  })
  .partial()
const AiChatBody = z.object({
  key: z.string(),
  assistant: z.string(),
  pid: z.number().int(),
  bundleId: z.string(),
  url: z.string().nullable(),
  windowTitle: z.string().nullable(),
})
const PerceptionBody = z
  .object({
    aiChat: AiChatBody.nullable(),
    now: NowContext.nullable(),
    chatExcerpt: z.string(),
    pageContext: z.string(),
  })
  .partial()

export function createTestControlApi(d: TestControlDeps): TestControlApi {
  const { core, handlers, fakes } = d
  const helper = fakes.helper
  const perception = fakes.perception
  return {
    overlayState: () => core.overlay.state,
    session: () => core.services.study.current(),
    appState: () => core.appState(),
    frontmost: () => core.services.helper.call('frontmost', {}).catch(() => null),
    windows: d.windows,
    async gesture(body) {
      const b = GestureBody.parse(body)
      return { decision: await core.router.gesture(b.gesture, { secureInput: b.secureInput }) }
    },
    async overlayAction(body) {
      const b = ActionBody.parse(body)
      const ctx = { surface: 'overlay' as const, displayId: b.displayId ?? null }
      await runHandler('overlay.action', handlers, b.action, ctx, true)
      return { ok: true }
    },
    async invoke(body) {
      const b = InvokeBody.parse(body)
      if (!Object.hasOwn(ipcInvoke, b.channel)) throw new Error(`Unknown channel "${b.channel}"`)
      const ctx = { surface: 'app' as const, displayId: null }
      const result = await runHandler(b.channel as InvokeChannel, handlers, b.payload, ctx, true)
      return { result: result ?? null }
    },
    cancel: () => ({ cancelled: core.router.cancel() }),
    key(body) {
      const b = KeyBody.parse(body)
      d.forwardKey(b.key)
      return { ok: true }
    },
    fakeHelperEvent: helper
      ? (body) => {
          const b = HelperEventBody.parse(body)
          helper.emit(b.event, b.payload as never)
          return { ok: true }
        }
      : undefined,
    fakeHelperState: helper
      ? (body) => {
          const b = HelperStateBody.parse(body)
          const s = helper.state
          for (const app of b.apps ?? []) s.apps.set(app.pid, app)
          if (b.writeResult) s.writeResult = b.writeResult
          if (b.chatInput) s.chatInput = b.chatInput
          if (b.selection !== undefined) s.selection = b.selection
          if (b.frontmost !== undefined) {
            if (b.frontmost) s.apps.set(b.frontmost.pid, b.frontmost)
            if (b.emitActivated && b.frontmost) helper.activateApp(b.frontmost)
            else s.frontmost = b.frontmost
          }
          if (b.focused !== undefined || b.fieldValue !== undefined) {
            const focused = b.focused === undefined ? s.focused : b.focused
            const value = b.fieldValue === undefined ? s.fieldValue : b.fieldValue
            if (b.emitFocus) helper.focus(focused, value)
            else {
              s.focused = focused
              s.fieldValue = value
            }
          }
          return { frontmost: s.frontmost, focused: s.focused, fieldValue: s.fieldValue }
        }
      : undefined,
    fakePerception: perception
      ? (body) => {
          const b = PerceptionBody.parse(body)
          if (b.chatExcerpt !== undefined) perception.setChatExcerpt(b.chatExcerpt)
          if (b.pageContext !== undefined) perception.setPageContext(b.pageContext)
          if (b.now !== undefined) perception.setNow(b.now)
          if (b.aiChat !== undefined) perception.setAiChat(b.aiChat)
          return { aiChat: perception.aiChat(), now: perception.now() }
        }
      : undefined,
  }
}
