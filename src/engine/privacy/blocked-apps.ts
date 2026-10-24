/**
 * Built-in app blocklist: bundle ids whose windows are never read (docs/PLAN.md §6.4, §6.9).
 *
 * Entries ending in "." are prefixes (e.g. "com.agilebits." covers every 1Password build).
 * `BANKING_BUNDLE_KEYWORDS` catches banking/payment apps we don't know by id (iOS apps running on
 * Apple Silicon keep their iOS bundle ids). Users add more in Settings → Capture.
 */
import { APP_BUNDLE_ID, HELPER_BUNDLE_ID } from '@shared/constants'

export type BlockCategory =
  | 'self'
  | 'password_manager'
  | 'system'
  | 'banking'
  | 'messaging'
  | 'crypto'
  | 'private_browser'

export const BLOCKED_APPS: Readonly<Record<BlockCategory, readonly string[]>> = {
  self: [APP_BUNDLE_ID, HELPER_BUNDLE_ID, 'com.github.Electron'],
  password_manager: [
    'com.1password.', // 1Password 8 + helpers
    'com.agilebits.', // 1Password 7 and older
    // exact ids of the common builds, so the helper can skip them without prefix matching
    'com.1password.1password',
    'com.agilebits.onepassword7',
    'com.agilebits.onepassword-osx',
    'com.lastpass.LastPass',
    'com.dashlane.dashlanephonefinal',
    'me.proton.pass.electron',
    '2BUA8C4S2C.com.1password.',
    '2BUA8C4S2C.com.agilebits.',
    'com.bitwarden.desktop',
    'com.8bit.bitwarden',
    'com.lastpass.',
    'com.dashlane.',
    'com.apple.keychainaccess',
    'com.apple.Passwords',
    'com.apple.Passwords.MenuBarExtra',
    'org.keepassxc.keepassxc',
    'com.hicknhacksoftware.MacPass',
    'com.markmcguill.strongbox.mac',
    'in.sinew.Enpass-Desktop',
    'me.proton.pass.',
    'com.nordpass.',
    'com.keepersecurity.',
    'com.siber.roboform',
    'com.outercorner.Secrets',
  ],
  system: [
    'com.apple.systempreferences',
    'com.apple.Settings',
    'com.apple.SecurityAgent',
    'com.apple.LocalAuthentication.UIAgent',
    'com.apple.loginwindow',
    'com.apple.CoreServicesUIAgent',
    'com.apple.ScreenSaver.Engine',
  ],
  banking: [
    'com.apple.Passbook',
    'com.revolut.',
    'com.transferwise.',
    'com.paypal.',
    'com.yourcompany.PPClient', // PayPal iOS app
    'com.klarna.',
    'com.n26.',
    'com.monzo.',
    'fi.op.', // OP Financial Group
    'fi.nordea.',
    'com.nordea.',
    'fi.spankki.',
    'fi.aktia.',
    'fi.saastopankki.',
    'fi.omasp.',
    'fi.poppankki.',
    'com.danskebank.',
    'dk.danskebank.',
    'com.handelsbanken.',
    'se.handelsbanken.',
    'se.seb.',
    'se.swedbank.',
    'se.bankgirot.swish',
    'com.bankid.',
    'no.dnb.',
    'no.vipps.',
    'com.mobilepay.',
    'com.lunarway.',
    'com.chase',
    'com.bankofamerica.',
    'com.wellsfargo.',
    'com.intuit.', // Quicken / TurboTax / Mint
  ],
  messaging: [
    'com.apple.MobileSMS', // Messages
    'com.apple.FaceTime',
    'net.whatsapp.WhatsApp',
    'desktop.WhatsApp',
    'WhatsApp',
    'org.whispersystems.signal-desktop',
    'ru.keepcoder.Telegram',
    'org.telegram.desktop',
    'com.tdesktop.Telegram',
    'com.facebook.archon', // Messenger
    'ch.threema.',
    'com.wearezeta.zclient.mac', // Wire
    'com.viber.osx',
    'com.tencent.xinWeChat',
    'jp.naver.line.mac',
    'im.riot.app', // Element
  ],
  crypto: [
    'com.ledger.live',
    'com.electron.ledger-live',
    'io.trezor.TrezorSuite',
    'org.electrum.electrum',
    'com.exodus.',
  ],
  private_browser: ['org.torproject.torbrowser'],
}

/** Lower-case keywords that mark a bundle id as a banking/payment app. */
export const BANKING_BUNDLE_KEYWORDS: readonly string[] = [
  'bank',
  'pankki',
  'mobilepay',
  'paypal',
  'revolut',
  'transferwise',
  'klarna',
  'vipps',
  'swish',
]

const ALL_ENTRIES: readonly { entry: string; category: BlockCategory }[] = (
  Object.entries(BLOCKED_APPS) as [BlockCategory, readonly string[]][]
).flatMap(([category, entries]) => entries.map((entry) => ({ entry, category })))

/** Exact ids from the built-in list (prefix entries excluded): what the helper can skip itself. */
export const BUILTIN_EXCLUDED_BUNDLE_IDS: readonly string[] = ALL_ENTRIES.filter(
  (e) => !e.entry.endsWith('.'),
).map((e) => e.entry)

export function bundleEntryMatches(bundleId: string, entry: string): boolean {
  const id = bundleId.toLowerCase()
  const e = entry.toLowerCase()
  return e.endsWith('.') ? id.startsWith(e) : id === e
}

/** Category of a blocked bundle id, or null when the app may be read. */
export function blockedAppCategory(bundleId: string): BlockCategory | null {
  if (!bundleId) return null
  for (const { entry, category } of ALL_ENTRIES) {
    if (bundleEntryMatches(bundleId, entry)) return category
  }
  const lower = bundleId.toLowerCase()
  if (BANKING_BUNDLE_KEYWORDS.some((k) => lower.includes(k))) return 'banking'
  return null
}
