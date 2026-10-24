/**
 * API key lookup for the cloud backends. Injectable so the shell can read keys from the Keychain;
 * the default reads `process.env` first, then a dotenv-style `.env.local` (development only),
 * re-reading the file when it changes so a key added mid-session is picked up. Keys are never
 * logged.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export type KeyName = 'GROQ_API_KEY' | 'MISTRAL_API_KEY' | 'OVH_AI_ENDPOINTS_TOKEN'
export type KeyGetter = (name: KeyName) => string | undefined

/** Parses KEY=value lines; ignores comments, blank lines and `export ` prefixes; strips quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m?.[1]) continue
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

export interface KeyGetterOptions {
  env?: Record<string, string | undefined>
  /** Default: `$DUMBLEDORE_ENV_FILE` or `<cwd>/.env.local`. */
  envFile?: string | null
}

export function createKeyGetter(opts: KeyGetterOptions = {}): KeyGetter {
  const env = opts.env ?? process.env
  const file =
    opts.envFile === null
      ? null
      : (opts.envFile ?? env.DUMBLEDORE_ENV_FILE ?? resolve(process.cwd(), '.env.local'))
  let cachedMtime = -1
  let cached: Record<string, string> = {}

  const fromFile = (): Record<string, string> => {
    if (!file) return {}
    try {
      const mtime = statSync(file).mtimeMs
      if (mtime !== cachedMtime) {
        cached = parseDotenv(readFileSync(file, 'utf8'))
        cachedMtime = mtime
      }
    } catch {
      cached = {}
      cachedMtime = -1
    }
    return cached
  }

  return (name) => {
    const direct = env[name]?.trim()
    if (direct) return direct
    const value = fromFile()[name]?.trim()
    return value ? value : undefined
  }
}
