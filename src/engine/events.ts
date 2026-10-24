/**
 * Engine event bus: the one place modules announce things to each other and to the shell.
 * Payloads are plain data. Helper notifications are forwarded unchanged under `helper:*` names.
 */
import type { Episode, Id, Nudge, Settings } from '@shared/domain'
import type { HelperEventPayload, PerceivedWindow } from '@shared/helper-protocol'
import type { MemoryChanged, NowContext, SessionState, Toast } from '@shared/state'
import { TypedBus } from './bus'
import type { AiChatInfo, HelperStatus } from './contracts'

export interface EngineEvents {
  'helper:status': { status: HelperStatus }
  'helper:focus': HelperEventPayload<'focus.changed'>
  'helper:appActivated': HelperEventPayload<'app.activated'>
  'helper:key': HelperEventPayload<'key.trigger'>
  'helper:screenLocked': { locked: boolean }
  'helper:displays': HelperEventPayload<'display.changed'>

  'perception:window': { window: PerceivedWindow }
  'perception:episodeClosed': { episode: Episode }
  'perception:now': { now: NowContext | null }
  'perception:aiChat': { chat: AiChatInfo | null }

  'memory:changed': MemoryChanged
  'session:changed': { session: SessionState | null }
  'quiz:open': { quizId: Id }
  'nudge:ready': { nudge: Nudge }
  'toast:show': { toast: Toast }
  'settings:changed': { settings: Settings }
  'thinking:changed': { busy: boolean; label: string | null }
}

export type EngineBus = TypedBus<EngineEvents>

export function createEngineBus(): EngineBus {
  return new TypedBus<EngineEvents>()
}
