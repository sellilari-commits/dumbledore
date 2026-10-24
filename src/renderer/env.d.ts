/// <reference types="vite/client" />
import type { DumbledoreApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload in Electron; absent in a plain browser (mock API is used then). */
    dumbledore?: DumbledoreApi
  }
}
