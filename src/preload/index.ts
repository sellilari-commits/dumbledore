/**
 * Preload: exposes the typed `window.dumbledore` API (see shared/ipc.ts) to every window.
 * Sandboxed — no Node built-ins and no third-party imports; type-only imports are erased.
 */
import type { DumbledoreApi } from '@shared/ipc'
import { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX } from '@shared/ipc-names'
import { contextBridge, ipcRenderer } from 'electron'

function surfaceFromLocation(): DumbledoreApi['surface'] {
  const { location } = globalThis as unknown as { location: { pathname: string } }
  const page = location.pathname.split('/').pop() ?? ''
  if (page.startsWith('overlay')) return 'overlay'
  if (page.startsWith('panel')) return 'panel'
  if (page.startsWith('askbar')) return 'askbar'
  return 'app'
}

const api: DumbledoreApi = {
  surface: surfaceFromLocation(),
  invoke: ((channel: string, payload?: unknown) =>
    ipcRenderer.invoke(`${IPC_INVOKE_PREFIX}${channel}`, payload)) as DumbledoreApi['invoke'],
  on: ((event: string, listener: (payload: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on(`${IPC_EVENT_PREFIX}${event}`, handler)
    return () => {
      ipcRenderer.removeListener(`${IPC_EVENT_PREFIX}${event}`, handler)
    }
  }) as DumbledoreApi['on'],
}

contextBridge.exposeInMainWorld('dumbledore', api)
