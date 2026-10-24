/**
 * URL helpers shared by the privacy filter and perception: tolerant parsing of the browser URLs
 * the helper reports (they may lack a scheme), host normalisation and host/path matching.
 */

export interface ParsedUrl {
  host: string // lower-case, no "www.", no port
  path: string // always starts with "/"
  params: URLSearchParams
  hash: string
}

/** Parses a browser URL; tolerates a missing scheme. Returns null for non-web URLs. */
export function parseUrl(url: string | null | undefined): ParsedUrl | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // file:// PDFs etc. have no host; keep the path so callers can still look at it.
    if (parsed.protocol === 'file:') {
      return { host: '', path: decodeSafe(parsed.pathname), params: parsed.searchParams, hash: '' }
    }
    return null
  }
  return {
    host: normalizeHost(parsed.hostname),
    path: parsed.pathname || '/',
    params: parsed.searchParams,
    hash: parsed.hash,
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\d?\./, '')
}

export function hostOf(url: string | null | undefined): string | null {
  const p = parseUrl(url)
  return p?.host ? p.host : null
}

/**
 * Host pattern matching:
 *   "example.com"   → example.com and any subdomain of it
 *   "login.*"       → any host whose first label is "login"
 *   "*bank*"        → any label containing "bank" (use sparingly)
 *   ".xxx"          → a top-level domain
 */
export function hostMatches(host: string, pattern: string): boolean {
  const h = normalizeHost(host)
  const p = pattern.trim().toLowerCase()
  if (!h || !p) return false
  if (p.startsWith('.')) return h.endsWith(p)
  if (p.endsWith('.*')) {
    const label = p.slice(0, -2)
    return h.split('.')[0] === label
  }
  if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
    const needle = p.slice(1, -1)
    return h.split('.').some((l) => l.includes(needle))
  }
  return h === p || h.endsWith(`.${p}`)
}

export function matchesAnyHost(host: string, patterns: readonly string[]): string | null {
  for (const p of patterns) if (hostMatches(host, p)) return p
  return null
}

/** Lower-cased, non-empty path segments ("/a/B/" → ["a", "b"]). */
export function pathSegments(path: string): string[] {
  return path
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** URL without fragment and tracking params; used as a stable page identity. */
export function pageIdentity(url: string): string {
  const p = parseUrl(url)
  if (!p) return url.trim()
  const keep = new URLSearchParams()
  for (const [k, v] of p.params) {
    if (/^(utm_|fbclid$|gclid$|ref$|ref_src$|si$)/i.test(k)) continue
    keep.append(k, v)
  }
  const qs = keep.toString()
  const path = p.path.length > 1 ? p.path.replace(/\/+$/, '') : p.path
  return `${p.host}${path}${qs ? `?${qs}` : ''}`
}
