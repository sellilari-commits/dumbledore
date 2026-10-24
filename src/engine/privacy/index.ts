/** Privacy: what may be read (blocklists, private windows, user exclusions) and secret masking. */
export {
  BANKING_BUNDLE_KEYWORDS,
  BLOCKED_APPS,
  type BlockCategory,
  BUILTIN_EXCLUDED_BUNDLE_IDS,
  blockedAppCategory,
} from './blocked-apps'
export {
  BLOCKED_HOSTS,
  BLOCKED_PATH_SEGMENTS,
  type HostCategory,
  PRIVATE_WINDOW_MARKERS,
} from './blocked-hosts'
export { ibanChecksumValid, luhnValid } from './checksums'
export {
  type AppLike,
  type BlockReason,
  blockReason,
  excludedBundleIds,
  isBlocked,
  type PrivacySettings,
  secretFileInTitle,
} from './is-blocked'
export {
  REDACTION_PLACEHOLDER,
  type RedactionCounts,
  type RedactionKind,
  redact,
  redactDetailed,
  redactSecrets,
} from './redact'
export { hostMatches, hostOf, normalizeHost, pageIdentity, parseUrl, pathSegments } from './url'
