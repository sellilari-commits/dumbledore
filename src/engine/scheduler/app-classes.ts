/**
 * App classification for natural-break detection: meeting apps and meeting pages in browsers
 * (never nudge there), leisure apps (leaving them is no break from work) and transient system or
 * Dumbledore windows (not a real app switch).
 */
import { APP_BUNDLE_ID, HELPER_BUNDLE_ID } from '@shared/constants'

const MEETING_BUNDLE_IDS = new Set([
  'us.zoom.xos', // zoom.us
  'com.microsoft.teams', // Microsoft Teams (classic)
  'com.microsoft.teams2', // Microsoft Teams
  'cisco-systems.spark', // Webex
  'com.webex.meetingmanager',
  'com.cisco.webexmeetingsapp',
  'com.apple.facetime',
])

const MEETING_APP_NAMES = new Set(['zoom.us', 'zoom', 'microsoft teams', 'webex', 'facetime'])

const MEETING_TITLES = [
  /^meet\s*[-–—:]/i, // "Meet - abc-defg-hij"
  /google meet/i,
  /microsoft teams/i,
  /zoom (meeting|webinar)/i,
  /webex/i,
  /facetime/i,
]

const LEISURE_BUNDLE_IDS = new Set([
  'com.apple.music',
  'com.spotify.client',
  'com.apple.mobilesms',
  'net.whatsapp.whatsapp',
  'desktop.whatsapp',
  'com.hnc.discord',
  'ru.keepcoder.telegram',
  'com.apple.photos',
  'com.apple.tv',
  'com.apple.podcasts',
])

const TRANSIENT_BUNDLE_IDS = new Set(
  [
    'com.apple.loginwindow',
    'com.apple.screensaver.engine',
    'com.apple.spotlight',
    'com.apple.dock',
    'com.apple.notificationcenterui',
    'com.apple.controlcenter',
    'com.apple.systemuiserver',
    'com.github.electron', // Dumbledore during development
    APP_BUNDLE_ID,
    HELPER_BUNDLE_ID,
  ].map((id) => id.toLowerCase()),
)

const lower = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

export function isMeetingApp(
  bundleId: string | null | undefined,
  appName?: string | null,
): boolean {
  return MEETING_BUNDLE_IDS.has(lower(bundleId)) || MEETING_APP_NAMES.has(lower(appName))
}

function hostAndPath(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url)
    return { host: u.hostname.toLowerCase(), path: u.pathname.toLowerCase() }
  } catch {
    return null
  }
}

/** Google Meet, Teams, Zoom's web client or Webex open in a browser tab. */
export function isMeetingPage(
  title: string | null | undefined,
  url: string | null | undefined,
): boolean {
  if (title && MEETING_TITLES.some((re) => re.test(title))) return true
  const parsed = url ? hostAndPath(url) : null
  if (!parsed) return false
  const { host, path } = parsed
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (on('meet.google.com') && path.length > 1) return true
  if (on('teams.microsoft.com') || on('teams.live.com')) return true
  if (on('zoom.us') && /^\/(wc|j|s)\//.test(path)) return true
  return on('webex.com') && /(meet|join|wbxmjs)/.test(path)
}

export const isLeisureApp = (bundleId: string | null | undefined): boolean =>
  LEISURE_BUNDLE_IDS.has(lower(bundleId))

export const isTransientApp = (bundleId: string | null | undefined): boolean =>
  TRANSIENT_BUNDLE_IDS.has(lower(bundleId))
