/**
 * Response cache: identical requests (task + prompt version + system + messages + schema) are
 * answered from memory for 24 h. Only validated results are stored. Injectable so the shell
 * could persist it; the default is a bounded in-memory LRU.
 */
import { createHash } from 'node:crypto'
import type { Clock } from '../../clock'

export interface ResponseCache {
  get(key: string): unknown | undefined
  set(key: string, value: unknown): void
}

export const CACHE_TTL_MS = 24 * 3_600_000

export function cacheKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function createMemoryCache(
  clock: Clock,
  opts: { ttlMs?: number; maxEntries?: number } = {},
): ResponseCache {
  const ttl = opts.ttlMs ?? CACHE_TTL_MS
  const max = opts.maxEntries ?? 500
  const entries = new Map<string, { at: number; value: unknown }>()
  return {
    get(key) {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (clock.now() - hit.at > ttl) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key) // refresh LRU position
      entries.set(key, hit)
      return structuredClone(hit.value)
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, { at: clock.now(), value: structuredClone(value) })
      while (entries.size > max) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
  }
}
