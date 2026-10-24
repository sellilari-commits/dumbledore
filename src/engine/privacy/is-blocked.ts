/**
 * The privacy gate: decides whether a window may be read at all (docs/PLAN.md §6.4 "Privacy
 * filter (before capture)"). Combines the built-in app/site lists, private-window markers and the
 * user's exclusions from Settings. Pure functions, no I/O.
 */
import type { Settings } from '@shared/domain'
import {
  type BlockCategory,
  BUILTIN_EXCLUDED_BUNDLE_IDS,
  blockedAppCategory,
  bundleEntryMatches,
} from './blocked-apps'
import {
  allBlockedHostEntries,
  BLOCKED_PATH_SEGMENTS,
  type HostCategory,
  PRIVATE_WINDOW_MARKERS,
} from './blocked-hosts'
import { hostMatches, normalizeHost, parseUrl, pathSegments } from './url'

export type BlockReason =
  | { kind: 'app'; category: BlockCategory }
  | { kind: 'user_app'; bundleId: string }
  | { kind: 'host'; category: HostCategory; pattern: string }
  | { kind: 'user_host'; pattern: string }
  | { kind: 'path'; segment: string }
  | { kind: 'private_window' }

export interface AppLike {
  bundleId: string
  appName?: string | null
}

/** The part of Settings the gate needs; a full Settings object works too. */
export type PrivacySettings = Pick<Settings, 'excludedBundleIds' | 'excludedHosts'>

/** App names that identify a password manager even when the bundle id is unknown. */
const PASSWORD_MANAGER_NAMES =
  /^(1password( \d+)?|bitwarden|lastpass|dashlane|keychain access|passwords|keepassxc|enpass|proton pass|nordpass|keeper)$/i

export function blockReason(
  app: AppLike | string | null,
  url: string | null | undefined,
  title: string | null | undefined,
  settings?: PrivacySettings | null,
): BlockReason | null {
  const bundleId = typeof app === 'string' ? app : (app?.bundleId ?? '')
  const appName = typeof app === 'string' ? null : (app?.appName ?? null)

  const category = blockedAppCategory(bundleId)
  if (category) return { kind: 'app', category }
  if (appName && PASSWORD_MANAGER_NAMES.test(appName.trim())) {
    return { kind: 'app', category: 'password_manager' }
  }
  for (const entry of settings?.excludedBundleIds ?? []) {
    if (entry.trim() && bundleEntryMatches(bundleId, entry.trim())) {
      return { kind: 'user_app', bundleId: entry }
    }
  }

  if (title && PRIVATE_WINDOW_MARKERS.some((re) => re.test(title))) {
    return { kind: 'private_window' }
  }

  const parsed = parseUrl(url)
  if (parsed?.host) {
    for (const raw of settings?.excludedHosts ?? []) {
      const pattern = userHostPattern(raw)
      if (pattern && hostMatches(parsed.host, pattern)) return { kind: 'user_host', pattern: raw }
    }
    for (const { pattern, category: hostCategory } of allBlockedHostEntries()) {
      if (hostMatches(parsed.host, pattern)) {
        return { kind: 'host', category: hostCategory, pattern }
      }
    }
    const segment = pathSegments(parsed.path).find((s) => BLOCKED_PATH_SEGMENTS.includes(s))
    if (segment) return { kind: 'path', segment }
  }
  return null
}

/** True when the window must not be read (built-in lists, private windows, user exclusions). */
export function isBlocked(
  app: AppLike | string | null,
  url: string | null | undefined,
  title: string | null | undefined,
  settings?: PrivacySettings | null,
): boolean {
  return blockReason(app, url, title, settings) !== null
}

/** Bundle ids to pass as `excludeBundleIds` to the helper: built-in exact ids + user ones. */
export function excludedBundleIds(settings?: PrivacySettings | null): string[] {
  const user = (settings?.excludedBundleIds ?? []).map((s) => s.trim()).filter(Boolean)
  return [...new Set([...BUILTIN_EXCLUDED_BUNDLE_IDS, ...user])]
}

/** Users paste anything ("https://x.com/a", "x.com", "*.x.com"); reduce it to a host pattern. */
function userHostPattern(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('*.')) return s.slice(2)
  if (s.includes('/') || s.includes(':')) {
    const parsed = parseUrl(s)
    return parsed?.host || null
  }
  return normalizeHost(s)
}
