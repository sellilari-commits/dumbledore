/**
 * Places that have chat-like text boxes but are never AI chats for Dumbledore: email, messaging,
 * documents and notes, search engines, social sites, code editors and terminals. These only stop
 * the *unknown*-chat rules (`composer.ts`); a catalog match (bundle id or site) is checked first,
 * so Google AI Mode or GitHub Copilot still count while Google Search and GitHub do not.
 *
 * Bundle ids: Apple's own apps, `mdls` on installed apps (Slack, WhatsApp, Telegram, Notion, VS
 * Code) and Homebrew cask metadata (Discord, Teams, Outlook, Word, Superhuman, Obsidian, Signal).
 */
import { bundleEntryMatches } from '../../privacy/blocked-apps'
import { hostMatches, parseUrl } from '../../privacy/url'
import { isCodingApp } from './coding'

const NON_CHAT_APPS: readonly string[] = [
  // email
  'com.apple.mail',
  'com.microsoft.Outlook',
  'com.superhuman.electron',
  'com.superhuman.mail',
  // messaging
  'com.tinyspeck.slackmacgap',
  'com.hnc.Discord',
  'com.microsoft.teams',
  'com.apple.MobileSMS',
  'net.whatsapp.WhatsApp',
  'ru.keepcoder.Telegram',
  'org.whispersystems.signal-desktop',
  // documents and notes
  'com.microsoft.Word',
  'com.microsoft.Excel',
  'com.microsoft.Powerpoint',
  'com.apple.iWork.',
  'com.apple.Notes',
  'com.apple.TextEdit',
  'notion.id',
  'md.obsidian',
]

const NON_CHAT_HOSTS: readonly string[] = [
  // email
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'proton.me',
  // messaging
  'slack.com',
  'discord.com',
  'whatsapp.com',
  'messenger.com',
  'teams.microsoft.com',
  'teams.live.com',
  'chat.google.com',
  'telegram.org',
  // documents, notes, LMS
  'docs.google.com',
  'drive.google.com',
  'office.com',
  'sharepoint.com',
  'notion.so',
  'notion.site',
  'overleaf.com',
  'instructure.com',
  // search, social, publishing, code hosting
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'youtube.com',
  'medium.com',
  'substack.com',
  'wikipedia.org',
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
]

export function isNonChatApp(bundleId: string): boolean {
  return isCodingApp(bundleId) || NON_CHAT_APPS.some((e) => bundleEntryMatches(bundleId, e))
}

export function isNonChatHost(url: string | null): boolean {
  const host = parseUrl(url)?.host
  return !!host && NON_CHAT_HOSTS.some((h) => hostMatches(host, h))
}
