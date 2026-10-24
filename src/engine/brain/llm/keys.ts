/**
 * API key lookup for the cloud backends. Injectable so the shell can read keys from the Keychain;
 * the default looks in `process.env`, then a dotenv-style `.env.local` (development only), then
 * the files listed in DUMBLEDORE_ENV_FILES (comma-separated; from the environment or `.env.local`).
 * Only the four key names below are ever imported from those files — other variables (the Hugo
 * env file holds many unrelated secrets) are skipped while parsing and never kept in memory.
 * Files are re-read when they change, so a key added mid-session is picked up. Keys are never
 * logged.
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

export const KEY_NAMES = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OVH_AI_ENDPOINTS_TOKEN',
] as const
export type KeyName = (typeof KEY_NAMES)[number]
export type KeyGetter = (name: KeyName) => string | undefined

const FILES_VAR = 'DUMBLEDORE_ENV_FILES'
const KEYS_ONLY: ReadonlySet<string> = new Set(KEY_NAMES)
const KEYS_AND_FILES: ReadonlySet<string> = new Set([...KEY_NAMES, FILES_VAR])

/**
 * Parses KEY=value lines; ignores comments, blank lines and `export ` prefixes; strips quotes.
 * With `only`, every other variable is skipped before its value is read.
 */
export function parseDotenv(text: string, only?: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m?.[1] || (only && !only.has(m[1]))) continue
    let value = (m[2] ?? '').trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    out[m[1]] = value
  }
  return out
}

/** "~/a/.env, ./b.env" → absolute paths (relative ones against `base`). */
export function parseFileList(spec: string | undefined, base: string): string[] {
  if (!spec) return []
  return spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p === '~' || p.startsWith('~/') ? `${homedir()}${p.slice(1)}` : p))
    .map((p) => (isAbsolute(p) ? p : resolve(base, p)))
}

/** One dotenv file, filtered to `only`, re-parsed when its mtime changes; missing = empty. */
function watchedFile(path: string, only: ReadonlySet<string>): () => Record<string, string> {
  let mtime = -1
  let values: Record<string, string> = {}
  return () => {
    try {
      const m = statSync(path).mtimeMs
      if (m !== mtime) {
        values = parseDotenv(readFileSync(path, 'utf8'), only)
        mtime = m
      }
    } catch {
      values = {}
      mtime = -1
    }
    return values
  }
}

export interface KeyGetterOptions {
  env?: Record<string, string | undefined>
  /** Default: `$DUMBLEDORE_ENV_FILE` or `<cwd>/.env.local`; null disables it. */
  envFile?: string | null
  /**
   * Extra key files, searched in order after the env file. Default: DUMBLEDORE_ENV_FILES from
   * `env`, else from the env file; null disables them.
   */
  envFiles?: string[] | null
  /** Base for relative paths (default: cwd). */
  cwd?: string
}

export function createKeyGetter(opts: KeyGetterOptions = {}): KeyGetter {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  const file =
    opts.envFile === null
      ? null
      : (opts.envFile ?? env.DUMBLEDORE_ENV_FILE ?? resolve(cwd, '.env.local'))
  const local = file ? watchedFile(file, KEYS_AND_FILES) : () => ({}) as Record<string, string>
  const extras = new Map<string, () => Record<string, string>>()

  const extraFiles = (): string[] => {
    if (opts.envFiles === null) return []
    if (opts.envFiles) return opts.envFiles
    const spec = env[FILES_VAR]?.trim() || local()[FILES_VAR]?.trim()
    return parseFileList(spec, cwd)
  }

  return (name) => {
    if (!KEYS_ONLY.has(name)) return undefined
    const direct = env[name]?.trim()
    if (direct) return direct
    const fromLocal = local()[name]?.trim()
    if (fromLocal) return fromLocal
    for (const path of extraFiles()) {
      let read = extras.get(path)
      if (!read) {
        read = watchedFile(path, KEYS_ONLY)
        extras.set(path, read)
      }
      const value = read()[name]?.trim()
      if (value) return value
    }
    return undefined
  }
}
