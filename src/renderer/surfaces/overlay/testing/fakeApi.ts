/**
 * Test helpers: a recording fake of `window.dumbledore` and OverlayState builders.
 * Test-only; nothing in the app imports this file.
 */
import type { OverlayAction, OverlayState } from '@shared/state'
import { createLocalApi, type InvokeHandlers, type LocalApi } from '../lib/localApi'
import { type SceneName, sceneState } from '../mock/scenes'

export const VIEWPORT = { width: 1024, height: 768 }

export function fakeApi(
  handlers: InvokeHandlers = {},
  surface: 'overlay' | 'askbar' = 'overlay',
): LocalApi {
  return createLocalApi(surface, {
    'overlay.action': () => undefined,
    ...handlers,
  })
}

/** OverlayActions the page sent, in order. */
export function sent(local: LocalApi): OverlayAction[] {
  return local.calls
    .filter((c) => c.channel === 'overlay.action')
    .map((c) => c.payload as OverlayAction)
}

export function sentTypes(local: LocalApi, ignoreHover = true): string[] {
  return sent(local)
    .filter((a) => !ignoreHover || a.type !== 'hover')
    .map((a) => a.type)
}

export function state(scene: SceneName = 'idle', patch: Partial<OverlayState> = {}): OverlayState {
  return { ...sceneState(scene, VIEWPORT), ...patch }
}

/** A fake API whose overlay.getState serves `initial`. */
export function overlayApi(initial: OverlayState, handlers: InvokeHandlers = {}): LocalApi {
  return fakeApi({ 'overlay.getState': () => initial, ...handlers })
}
