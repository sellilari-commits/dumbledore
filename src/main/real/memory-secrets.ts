/**
 * In-memory SecretStore for composeReal when the shell passes none (tests, scripts). The shell's
 * safeStorage store (src/main/secrets.ts) is the production one; values here die with the process.
 */
import type { SecretKey, SecretStore } from '../services'

export function memorySecrets(): SecretStore {
  const values = new Map<SecretKey, string>()
  return {
    set(key, value) {
      const trimmed = value.trim()
      if (trimmed) values.set(key, trimmed)
      else values.delete(key)
    },
    get: (key) => values.get(key) ?? null,
    has: (key) => values.has(key),
  }
}
