/**
 * API keys at rest: encrypted with Electron safeStorage (Keychain-backed on macOS) in
 * <data dir>/secrets.json, readable only by the owner. Falls back to memory when encryption is
 * unavailable, so a key is never written in plain text.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'
import type { SecretKey, SecretStore } from './services'

export class SafeStorageSecretStore implements SecretStore {
  private readonly memory = new Map<SecretKey, string>()

  constructor(private readonly file: string) {}

  set(key: SecretKey, value: string): void {
    const trimmed = value.trim()
    if (!safeStorage.isEncryptionAvailable()) {
      if (trimmed) this.memory.set(key, trimmed)
      else this.memory.delete(key)
      return
    }
    const all = this.readAll()
    if (trimmed) all[key] = safeStorage.encryptString(trimmed).toString('base64')
    else delete all[key]
    writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 })
    chmodSync(this.file, 0o600)
  }

  get(key: SecretKey): string | null {
    const fromMemory = this.memory.get(key)
    if (fromMemory) return fromMemory
    const sealed = this.readAll()[key]
    if (!sealed || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    } catch {
      return null
    }
  }

  has(key: SecretKey): boolean {
    return this.memory.has(key) || this.readAll()[key] !== undefined
  }

  private readAll(): Partial<Record<SecretKey, string>> {
    if (!existsSync(this.file)) return {}
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Record<SecretKey, string>>
    } catch {
      return {}
    }
  }
}
