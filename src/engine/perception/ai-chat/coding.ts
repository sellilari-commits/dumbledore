/**
 * Coding sessions are not study chats. The Claude app's Code tab, the ChatGPT app's Codex mode,
 * claude.ai/code, chatgpt.com/codex, editors and terminals all show an AI "chat", but what is on
 * screen is a coding agent at work, and episodes from it must not become ai_chat study records.
 *
 * Code editors and terminals are recognised by bundle id. Inside a chat app the signal is the
 * screen itself: several *kinds* of agent evidence at once — tool runs ("Bash(npm test)",
 * "Read src/app.ts"), diffs, permission prompts and agent controls ("Allow once", "Accept
 * edits"), plus file paths and shell commands. One kind alone never decides, and a study chat
 * that merely shows code (paths, a `pip install`) stays a chat: at least one agent-only kind
 * (tool run, diff, agent control, coding title) has to be present.
 */
import { bundleEntryMatches } from '../../privacy/blocked-apps'
import { hostMatches, parseUrl } from '../../privacy/url'

/** Editors, IDEs, terminals and coding-agent apps (cask uninstall/zap ids, 2026-10-24). */
export const CODING_APP_BUNDLES: readonly string[] = [
  'com.microsoft.VSCode',
  'com.microsoft.VSCodeInsiders',
  'com.todesktop.230313mzl4w4u92', // Cursor
  'dev.zed.Zed',
  'com.google.Antigravity',
  'dev.kiro.desktop',
  'com.trae.app',
  'com.voideditor.Void',
  'com.sublimetext.',
  'com.panic.Nova',
  'com.barebones.bbedit',
  'com.jetbrains.',
  'com.google.android.studio',
  'com.apple.dt.Xcode',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'dev.warp.Warp-Stable',
  'com.mitchellh.ghostty',
  'org.alacritty',
  'net.kovidgoyal.kitty',
  'com.github.wez.wezterm',
  'org.tabby',
  'co.zeit.hyper',
  'com.github.githubapp', // GitHub Copilot (coding agent)
  'com.t3tools.t3code',
  'com.idealapp.Clarc',
  'opcode.asterisk.so',
  'com.electron.sculptor',
  'com.stravu.crystal',
  'dev.milisp.codexia',
  'com.nimbalyst.electron',
]

/** Coding-agent pages of chat sites. */
const CODING_SITES: readonly { host: string; pathPrefix: string }[] = [
  { host: 'claude.ai', pathPrefix: '/code' },
  { host: 'chatgpt.com', pathPrefix: '/codex' },
]

export function isCodingApp(bundleId: string): boolean {
  return CODING_APP_BUNDLES.some((entry) => bundleEntryMatches(bundleId, entry))
}

export function isCodingSite(url: string | null): boolean {
  const p = parseUrl(url)
  if (!p?.host) return false
  const path = p.path.toLowerCase()
  return CODING_SITES.some(
    (s) =>
      hostMatches(p.host, s.host) && (path === s.pathPrefix || path.startsWith(`${s.pathPrefix}/`)),
  )
}

type Kind = 'tool' | 'diff' | 'agent' | 'title' | 'path' | 'shell'
const AGENT_ONLY: ReadonlySet<Kind> = new Set(['tool', 'diff', 'agent', 'title'])

const TOOL_CALL =
  /^(?:[⏺●•✓✔⎿>-]\s*)?(?:Bash|Read|Edit|Write|MultiEdit|Update|Grep|Glob|LS|WebFetch|WebSearch|Task|TodoWrite|NotebookEdit|apply_patch|shell|exec)\s*\(/
const TOOL_DONE =
  /^(?:[⏺●•✓✔⎿]\s*)?(?:Ran|Edited|Read|Created|Deleted|Explored|Searched|Wrote|Updated)\s+(?:\d+\s+(?:files?|lines?|commands?)\b|`|[\w.-]*\/[\w./-]+|[\w-]+\.[a-z]{1,5}\b)/
const DIFF = /^(?:@@ .+ @@|diff --git |index [0-9a-f]{7,}|\+{3} [ab]\/|-{3} [ab]\/|\+\d+\s+-\d+$)/
const AGENT_LINE =
  /^(?:Allow once|Always allow|Allow for this (?:session|chat)|Deny|Accept edits|Auto-accept edits|Accept all|Reject all|Plan mode|Bypass permissions|Review changes|Undo changes|Create PR|Open PR|Commit changes|Commit and push|Push to branch|New worktree|Run command\??|Allow this command\??)$/i
const AGENT_TEXT =
  /\b(?:esc to interrupt|ctrl\+c to (?:exit|interrupt)|accept edits on|bypass permissions on|tool use|tool call|wants to (?:run|edit|read|write)|do you want to (?:proceed|make this edit|run))\b/i
const PATH =
  /(?:^|[\s`'"(])(?:~|\.{1,2})?\/?(?:[\w.@-]+\/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|swift|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|json|ya?ml|toml|md|css|scss|html|sh|sql|lock)\b/
const SHELL =
  /^(?:\$|%|❯|➜)?\s*(?:npm|npx|pnpm|yarn|bun|git|python3?|pip3?|cargo|make|swift|xcodebuild|node|tsc|pytest|brew|docker|kubectl|gh|uv|go)\s+[\w-]/
const CODING_TITLE = /\b(?:Claude Code|Codex|Cursor|Windsurf|Visual Studio Code)\b/i

const MAX_LINE = 160

/** The kinds of coding-agent evidence on screen, with how often each was seen. */
export function codingEvidence(lines: readonly string[], title: string | null): Map<Kind, number> {
  const seen = new Map<Kind, number>()
  const add = (k: Kind) => seen.set(k, (seen.get(k) ?? 0) + 1)
  if (title && CODING_TITLE.test(title)) add('title')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.length > MAX_LINE) continue
    if (TOOL_CALL.test(line) || TOOL_DONE.test(line)) add('tool')
    if (DIFF.test(line)) add('diff')
    if (AGENT_LINE.test(line) || AGENT_TEXT.test(line)) add('agent')
    if (PATH.test(line)) add('path')
    if (SHELL.test(line)) add('shell')
  }
  return seen
}

/** True when the window shows a coding agent rather than a (study) conversation. */
export function looksLikeCodingSession(lines: readonly string[], title: string | null): boolean {
  const seen = codingEvidence(lines, title)
  const kinds = [...seen.keys()]
  const agentKinds = kinds.filter((k) => AGENT_ONLY.has(k)).length
  if (agentKinds === 0) return false
  if (agentKinds >= 2) return true
  // A coding title ("Claude Code", "Cursor") weighs double.
  const hits = [...seen.values()].reduce((a, b) => a + b, 0) + (seen.has('title') ? 1 : 0)
  return kinds.length >= 2 && hits >= 3
}
