import { DEFAULT_SETTINGS } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { blockReason, excludedBundleIds, isBlocked, secretFileInTitle } from './is-blocked'
import { hostMatches, pageIdentity, parseUrl } from './url'

const settings = {
  ...DEFAULT_SETTINGS,
  excludedBundleIds: ['com.example.diary'],
  excludedHosts: ['https://secret.example.org/x'],
}
const chrome = { bundleId: 'com.google.Chrome', appName: 'Google Chrome' }

describe('url helpers', () => {
  it('parses URLs with or without a scheme', () => {
    expect(parseUrl('en.wikipedia.org/wiki/SN1_reaction')?.host).toBe('en.wikipedia.org')
    expect(parseUrl('https://www.op.fi/kirjaudu')?.host).toBe('op.fi')
    expect(parseUrl('chrome://settings')).toBeNull()
    expect(parseUrl(null)).toBeNull()
  })

  it('matches hosts, subdomains, first labels, keywords and TLDs', () => {
    expect(hostMatches('op.fi', 'op.fi')).toBe(true)
    expect(hostMatches('oma.op.fi', 'op.fi')).toBe(true)
    expect(hostMatches('shop.fi', 'op.fi')).toBe(false)
    expect(hostMatches('login.example.com', 'login.*')).toBe(true)
    expect(hostMatches('blog.login.example.com', 'login.*')).toBe(false)
    expect(hostMatches('example.xxx', '.xxx')).toBe(true)
  })

  it('builds a stable page identity without fragments or tracking params', () => {
    expect(pageIdentity('https://en.wikipedia.org/wiki/SN1#Mechanism')).toBe(
      'en.wikipedia.org/wiki/SN1',
    )
    expect(pageIdentity('https://x.com/a/?utm_source=t&q=1')).toBe('x.com/a?q=1')
  })
})

describe('isBlocked', () => {
  it('never reads windows that show a secret file (.env, private keys, credentials)', () => {
    const editor = { bundleId: 'com.apple.TextEdit', appName: 'TextEdit' }
    for (const title of [
      '.env',
      '.env — Edited',
      'hugo-backend — .env.local',
      '.env — hugo — Visual Studio Code',
      'id_ed25519',
      'server.pem',
      'credentials.json — Downloads',
      'secrets.yaml',
      'service-account-prod.json',
      '.npmrc',
    ]) {
      expect(blockReason(editor, null, title), title).toMatchObject({ kind: 'secret_file' })
    }
    for (const title of [
      'README.md',
      'Environment variables – MDN',
      'notes about .envelope',
      'Keynote',
    ]) {
      expect(isBlocked(editor, null, title), title).toBe(false)
    }
    expect(secretFileInTitle('hugo-backend — .env')).toBe('.env')
  })

  it('blocks password managers, Keychain Access, Apple Passwords and System Settings', () => {
    for (const id of [
      'com.1password.1password',
      'com.agilebits.onepassword7',
      'com.bitwarden.desktop',
      'com.lastpass.LastPass',
      'com.dashlane.dashlanephonefinal',
      'com.apple.keychainaccess',
      'com.apple.Passwords',
      'com.apple.systempreferences',
    ]) {
      expect(isBlocked(id, null, null, settings), id).toBe(true)
    }
    expect(blockReason({ bundleId: 'unknown.id', appName: '1Password' }, null, null)).toEqual({
      kind: 'app',
      category: 'password_manager',
    })
  })

  it('blocks messaging and banking apps by default', () => {
    for (const id of [
      'com.apple.MobileSMS',
      'net.whatsapp.WhatsApp',
      'org.whispersystems.signal-desktop',
      'ru.keepcoder.Telegram',
    ]) {
      expect(blockReason(id, null, null)).toEqual({ kind: 'app', category: 'messaging' })
    }
    expect(blockReason('fi.op.mobiili', null, null)).toEqual({ kind: 'app', category: 'banking' })
    expect(blockReason('com.example.mobilebank', null, null)).toEqual({
      kind: 'app',
      category: 'banking',
    })
  })

  it('never reads Dumbledore itself', () => {
    expect(blockReason('org.stuhi.dumbledore', null, null)).toEqual({
      kind: 'app',
      category: 'self',
    })
  })

  it('blocks banks, sign-in pages, health portals, adult sites, crypto and brokers', () => {
    const blocked = [
      'https://www.op.fi/henkiloasiakkaat',
      'https://netbank.nordea.fi/login',
      'https://www.s-pankki.fi/',
      'https://verkkopankki.example.fi/',
      'https://accounts.google.com/signin/v2',
      'https://login.microsoftonline.com/common',
      'https://auth.example.com/',
      'https://www.omakanta.fi/',
      'https://mychart.hospital.org/',
      'https://www.pornhub.com/',
      'https://example.xxx/',
      'https://www.coinbase.com/',
      'https://www.nordnet.fi/',
      'https://mycourses.aalto.fi/login/index.php',
    ]
    for (const url of blocked) expect(isBlocked(chrome, url, 'Page', settings), url).toBe(true)
  })

  it('lets study pages and AI chats through', () => {
    const allowed = [
      'https://en.wikipedia.org/wiki/SN1_reaction',
      'https://id.wikipedia.org/wiki/Kimia',
      'https://mycourses.aalto.fi/mod/assign/view.php?id=123',
      'https://chatgpt.com/c/abc',
      'https://gemini.google.com/app',
      'https://arxiv.org/abs/2401.00001',
      'https://www.worldbank.org/en/topic/poverty',
      'https://www.essex.ac.uk/courses',
      'https://www.booking.com/',
    ]
    for (const url of allowed) expect(isBlocked(chrome, url, 'Page', settings), url).toBe(false)
  })

  it('blocks private and incognito windows by title', () => {
    expect(blockReason(chrome, 'https://reddit.com', 'Reddit - Google Chrome (Incognito)')).toEqual(
      { kind: 'private_window' },
    )
    expect(isBlocked('org.mozilla.firefox', null, 'Mozilla Firefox Private Browsing')).toBe(true)
    expect(isBlocked('com.microsoft.edgemac', null, 'New tab - InPrivate')).toBe(true)
  })

  it('applies user exclusions for apps and hosts', () => {
    expect(blockReason('com.example.diary', null, null, settings)).toEqual({
      kind: 'user_app',
      bundleId: 'com.example.diary',
    })
    expect(blockReason(chrome, 'https://docs.secret.example.org/a', 'x', settings)).toEqual({
      kind: 'user_host',
      pattern: 'https://secret.example.org/x',
    })
  })

  it('lists exact bundle ids for the helper, including user ones', () => {
    const ids = excludedBundleIds(settings)
    expect(ids).toContain('com.apple.keychainaccess')
    expect(ids).toContain('com.example.diary')
    expect(ids.some((id) => id.endsWith('.'))).toBe(false)
  })
})
