/**
 * Picks the API a surface talks to: the preload's `window.dumbledore` in Electron, or the mock
 * driver in a plain browser (or with `?mock=1`). The mock is loaded lazily so it never ships in
 * the overlay's main chunk.
 */
import type { DumbledoreApi } from '@shared/ipc'

export type SurfaceName = 'overlay' | 'askbar'

export function wantsMock(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('mock') === '1' || !window.dumbledore
}

export async function resolveApi(surface: SurfaceName): Promise<DumbledoreApi> {
  if (!wantsMock() && window.dumbledore) return window.dumbledore
  const { createMockApi } = await import('../mock/mockApi')
  return createMockApi(surface)
}

/** `?display=<id>` → the display this overlay window covers; null when absent or malformed. */
export function displayFromQuery(search: string = window.location.search): number | null {
  const raw = new URLSearchParams(search).get('display')
  if (raw === null || raw.trim() === '') return null
  const id = Number(raw)
  return Number.isInteger(id) ? id : null
}

/** Logs instead of throwing: a failed fire-and-forget IPC call must never break the overlay. */
export function report(error: unknown, what: string): void {
  console.warn(`[dumbledore] ${what} failed`, error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error ? error : 'Something went wrong'
}
