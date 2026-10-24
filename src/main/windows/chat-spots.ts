/**
 * Where the student dragged the double-tap chat, and how big they made it, per display, kept in a
 * small JSON file in the data folder so the chat reopens there after a restart. Read and write errors are ignored: the
 * chat then simply opens beside the orb.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { ChatSpot, ChatSpots } from './placement'

export interface ChatSpotStore {
  load(): ChatSpots
  save(spots: ChatSpots): void
}

export function fileChatSpotStore(file: string): ChatSpotStore {
  return {
    load() {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as unknown
        if (!data || typeof data !== 'object') return {}
        const spots: ChatSpots = {}
        for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
          const s = v as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null
          if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
          const spot: ChatSpot = { x: Number(s.x), y: Number(s.y) }
          const w = Number(s.width)
          const h = Number(s.height)
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            spot.width = w
            spot.height = h
          }
          spots[id] = spot
        }
        return spots
      } catch {
        return {}
      }
    },
    save(spots) {
      try {
        writeFileSync(file, JSON.stringify(spots), 'utf8')
      } catch {
        // Not worth failing over: the chat opens beside the orb next time.
      }
    },
  }
}

/** In-memory store (tests, and when no data folder is given). */
export function memoryChatSpotStore(initial: ChatSpots = {}): ChatSpotStore {
  let spots = { ...initial }
  return {
    load: () => ({ ...spots }),
    save: (next) => {
      spots = { ...next }
    },
  }
}
