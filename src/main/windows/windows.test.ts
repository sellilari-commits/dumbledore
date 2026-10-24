import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CHAT_PANEL_WIDTH,
  chatPanelHeight,
  chatSizeLimits,
  clampChatSize,
  isPromptRoute,
} from '@shared/chat-panel'
import { describe, expect, it, vi } from 'vitest'
import { DISPLAY, SECOND_DISPLAY } from '../testing/harness'
import { fileChatSpotStore, memoryChatSpotStore } from './chat-spots'
import {
  askbarBounds,
  askbarOpenBounds,
  askbarResize,
  chatBounds,
  chatOpenBounds,
  clampRect,
  PANEL_SIZE,
  panelBounds,
  panelOpenSize,
  resizeKeepingTop,
  sameRect,
} from './placement'
import { mimeType, resolveRendererPath, responseHeaders } from './protocol'
import { devCsp, isExternalLink, isOwnUrl, PROD_CSP, pageUrl, rendererBase } from './urls'

vi.mock('electron', () => ({ protocol: {} }))

const ROOT = resolve('/tmp/dd-renderer')

describe('renderer protocol', () => {
  it('maps dumbledore://renderer/ URLs into the renderer folder', () => {
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/overlay.html')).toBe(
      join(ROOT, 'overlay.html'),
    )
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/assets/app-1a2b.js?x=1#y')).toBe(
      join(ROOT, 'assets', 'app-1a2b.js'),
    )
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/')).toBe(join(ROOT, 'index.html'))
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/a%20b.css')).toBe(join(ROOT, 'a b.css'))
  })

  it('refuses other hosts, schemes, path escapes and malformed URLs', () => {
    expect(resolveRendererPath(ROOT, 'dumbledore://evil/overlay.html')).toBeNull()
    expect(resolveRendererPath(ROOT, 'file:///etc/passwd')).toBeNull()
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/..%2F..%2Fetc%2Fpasswd')).toBeNull()
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/%E0%A4%A')).toBeNull()
    expect(resolveRendererPath(ROOT, 'dumbledore://renderer/a%00.html')).toBeNull()
    expect(resolveRendererPath(ROOT, 'not a url')).toBeNull()
  })

  it('sends the CSP with HTML and the right content types', () => {
    expect(mimeType('/x/app.JS')).toBe('text/javascript; charset=utf-8')
    expect(mimeType('/x/font.woff2')).toBe('font/woff2')
    expect(mimeType('/x/blob.bin')).toBe('application/octet-stream')
    const html = responseHeaders('/x/app.html')
    expect(html['Content-Security-Policy']).toBe(PROD_CSP)
    expect(html['X-Content-Type-Options']).toBe('nosniff')
    expect(responseHeaders('/x/app.css')['Content-Security-Policy']).toBeUndefined()
  })
})

describe('renderer URLs', () => {
  it('builds page URLs for production and the dev server', () => {
    expect(pageUrl('overlay', { query: { display: '2' } }, null)).toBe(
      'dumbledore://renderer/overlay.html?display=2',
    )
    expect(pageUrl('app', { route: 'settings/general' }, 'http://localhost:5173/')).toBe(
      'http://localhost:5173/app.html#/settings/general',
    )
    expect(rendererBase('http://localhost:5173///')).toBe('http://localhost:5173')
  })

  it('knows our own pages from everything else', () => {
    expect(isOwnUrl('dumbledore://renderer/panel.html#/picker', null)).toBe(true)
    expect(isOwnUrl('https://chatgpt.com/', null)).toBe(false)
    expect(isOwnUrl('http://localhost:5173/app.html', 'http://localhost:5173')).toBe(true)
    expect(isOwnUrl('http://localhost:9999/app.html', 'http://localhost:5173')).toBe(false)
    expect(isOwnUrl('::', null)).toBe(false)
  })

  it('hands only web and mail links to the outside world', () => {
    expect(isExternalLink('https://en.wikipedia.org/wiki/SN1_reaction')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('mailto:teacher@example.com')).toBe(true)
    expect(isExternalLink('file:///etc/passwd')).toBe(false)
    expect(isExternalLink('javascript:alert(1)')).toBe(false)
    expect(isExternalLink('x-apple.systempreferences:com.apple.preference.security')).toBe(false)
    expect(isExternalLink('nope')).toBe(false)
  })

  it('keeps the production CSP strict and lets the dev server talk to its HMR socket', () => {
    expect(PROD_CSP).toContain("default-src 'none'")
    expect(PROD_CSP).toContain("script-src 'self'")
    expect(PROD_CSP).not.toContain('unsafe-eval')
    expect(devCsp('http://localhost:5173')).toContain('connect-src')
    expect(devCsp('http://localhost:5173')).toContain('ws://localhost:5173')
  })
})

describe('window placement', () => {
  const wa = DISPLAY.workArea

  it('clamps a rectangle into an area with a margin', () => {
    expect(clampRect({ x: -50, y: 2000, width: 100, height: 100 }, wa)).toEqual({
      x: 8,
      y: wa.y + wa.height - 8 - 100,
      width: 100,
      height: 100,
    })
  })

  it('opens the panel beside the orb, toward the middle of the screen', () => {
    const right = panelBounds(DISPLAY, { displayId: 1, x: 1480, y: 491, edge: 'right' })
    expect(right.x + right.width).toBeLessThanOrEqual(1480 - 20)
    expect(right).toMatchObject(PANEL_SIZE)
    const left = panelBounds(DISPLAY, { displayId: 1, x: 32, y: 491, edge: 'left' })
    expect(left.x).toBeGreaterThanOrEqual(32 + 20)
    const top = panelBounds(DISPLAY, { displayId: 1, x: 756, y: 60, edge: 'top' })
    expect(top.y).toBeGreaterThan(60)
    expect(top.x + top.width / 2).toBeCloseTo(756, 0)
  })

  it('reopens the mini panel at its fitted size; the picker always gets the full size', () => {
    const fitted = { width: 380, height: 212 }
    expect(panelOpenSize('/', null)).toEqual(PANEL_SIZE)
    expect(panelOpenSize('/', fitted)).toEqual(fitted)
    expect(panelOpenSize(null, fitted)).toEqual(fitted)
    expect(panelOpenSize('/picker', fitted)).toEqual(PANEL_SIZE)
    const short = panelBounds(DISPLAY, { displayId: 1, x: 1480, y: 491, edge: 'right' }, fitted)
    expect(short).toMatchObject(fitted)
  })

  it('puts the ask bar over the focused field, or high and centred', () => {
    const field = { x: 400, y: 820, width: 700, height: 56 }
    const over = askbarBounds(DISPLAY, field)
    expect(over.y + over.height).toBeLessThanOrEqual(field.y)
    expect(over.x + over.width / 2).toBeCloseTo(750, 0)
    const centred = askbarBounds(DISPLAY, null)
    expect(centred.x + centred.width / 2).toBeCloseTo(wa.x + wa.width / 2, 0)
    expect(centred.y).toBeLessThan(wa.y + wa.height / 2)
    const nearTop = askbarBounds(DISPLAY, { x: 400, y: 40, width: 700, height: 30 })
    expect(nearTop.y).toBeGreaterThanOrEqual(40 + 30)
  })

  it('sizes the double-tap chat as a constant 380 × 520 box, smaller only on a short screen', () => {
    expect(CHAT_PANEL_WIDTH).toBe(380)
    expect(chatPanelHeight(982)).toBe(520)
    expect(chatPanelHeight(1400)).toBe(520)
    expect(chatPanelHeight(600)).toBe(520)
    expect(chatPanelHeight(400)).toBe(384) // a short screen still keeps a margin
    expect(chatPanelHeight(0)).toBe(520)
    expect(isPromptRoute('prompt')).toBe(true)
    expect(isPromptRoute('#/prompt')).toBe(true)
    expect(isPromptRoute(null)).toBe(false)
  })

  it('opens the double-tap chat beside the orb, centred on it, never over it', () => {
    const orb = { displayId: 1, x: 1480, y: 491, edge: 'right' as const }
    const chat = chatBounds(DISPLAY, orb)
    expect(chat.width).toBe(CHAT_PANEL_WIDTH)
    expect(chat.height).toBe(chatPanelHeight(wa.height))
    expect(chat.x + chat.width).toBeLessThanOrEqual(1480 - 20)
    expect(chat.y + chat.height / 2).toBeCloseTo(491, 0)
    const low = chatBounds(DISPLAY, { ...orb, y: wa.y + wa.height - 30 })
    expect(low.y + low.height).toBeLessThanOrEqual(wa.y + wa.height - 8)
    const left = chatBounds(DISPLAY, { displayId: 1, x: 32, y: 491, edge: 'left' })
    expect(left.x).toBeGreaterThanOrEqual(32 + 20)
    const none = chatBounds(DISPLAY, null)
    expect(none.x + none.width).toBeLessThanOrEqual(wa.x + wa.width - 8)
    expect(Math.abs(none.y + none.height / 2 - (wa.y + wa.height / 2))).toBeLessThanOrEqual(1)
  })

  it('opens the chat route at its full fixed size on first open; the study box stays compact', () => {
    const orb = { displayId: 1, x: 1480, y: 491, edge: 'right' as const }
    const chat = askbarOpenBounds(DISPLAY, null, orb, null)
    expect(chat).toEqual(chatBounds(DISPLAY, orb))
    expect(chat.height).toBe(chatPanelHeight(wa.height))
    expect(chat).toMatchObject({ width: 380, height: 520 })
    const field = { x: 400, y: 820, width: 700, height: 56 }
    expect(askbarOpenBounds(DISPLAY, null, orb, field)).toEqual(chat) // the chat ignores the field
    const box = askbarOpenBounds(DISPLAY, 'prompt', orb, null)
    expect(box).toMatchObject({ width: 560, height: 52 })
  })

  it('reopens the chat where the student dragged it on that display', () => {
    const orb = { displayId: 1, x: 1480, y: 491, edge: 'right' as const }
    const saved = { x: 120, y: 200 }
    expect(chatOpenBounds(DISPLAY, orb, saved)).toEqual({ x: 120, y: 200, width: 380, height: 520 })
    // The Ask bar passes the saved spot for the chat only, never for the study box.
    expect(askbarOpenBounds(DISPLAY, null, orb, null, saved)).toEqual(
      chatOpenBounds(DISPLAY, orb, saved),
    )
    expect(askbarOpenBounds(DISPLAY, 'prompt', orb, null, saved)).toMatchObject({ height: 52 })
    // Dragged half past the edge: it comes back fully on screen at the same height.
    const edge = chatOpenBounds(DISPLAY, orb, { x: 1300, y: 600 })
    expect(edge.x + edge.width).toBeLessThanOrEqual(wa.x + wa.width - 8)
    expect(edge.y + edge.height).toBeLessThanOrEqual(wa.y + wa.height - 8)
  })

  it('falls back to beside the orb when the saved spot is off this display', () => {
    const orb = { displayId: 1, x: 1480, y: 491, edge: 'right' as const }
    const beside = chatBounds(DISPLAY, orb)
    // A spot from the second display (to the right) is not on this one.
    expect(chatOpenBounds(DISPLAY, orb, { x: 2000, y: 300 })).toEqual(beside)
    expect(chatOpenBounds(DISPLAY, orb, { x: -900, y: 300 })).toEqual(beside)
    expect(chatOpenBounds(DISPLAY, orb, undefined)).toEqual(beside)
    // On its own display the same spot is fine.
    expect(chatOpenBounds(SECOND_DISPLAY, null, { x: 2000, y: 300 })).toMatchObject({
      x: 2000,
      y: 300,
    })
  })

  it('reopens the chat at the size the student resized it to, within the limits', () => {
    const orb = { displayId: 1, x: 1480, y: 491, edge: 'right' as const }
    const saved = { x: 120, y: 100, width: 600, height: 700 }
    expect(chatOpenBounds(DISPLAY, orb, saved)).toEqual(saved)
    // Off this display: beside the orb again, but still at the student's size.
    const beside = chatOpenBounds(DISPLAY, orb, { ...saved, x: 2000 })
    expect(beside).toMatchObject({ width: 600, height: 700 })
    expect(beside.x + beside.width).toBeLessThanOrEqual(orb.x)
    // Too small or too big is pulled back inside 320 × 360 … 900 × (work area − margin).
    expect(chatOpenBounds(DISPLAY, orb, { x: 100, y: 100, width: 100, height: 100 })).toMatchObject(
      {
        width: 320,
        height: 360,
      },
    )
    const huge = chatOpenBounds(DISPLAY, orb, { x: 10, y: 40, width: 4000, height: 4000 })
    expect(huge.width).toBe(900)
    expect(huge.height).toBe(DISPLAY.workArea.height - 16)
    expect(huge.y + huge.height).toBeLessThanOrEqual(wa.y + wa.height)
  })

  it('only the chat is resizable; the study box keeps its fixed size', () => {
    const limits = askbarResize(null, DISPLAY.workArea)
    expect(limits).toEqual({
      min: { width: 320, height: 360 },
      max: { width: 900, height: DISPLAY.workArea.height - 16 },
    })
    expect(askbarResize('/', DISPLAY.workArea)).toEqual(limits)
    expect(askbarResize('prompt', DISPLAY.workArea)).toBeNull()
    expect(askbarResize('#/prompt', DISPLAY.workArea)).toBeNull()
    // A tiny screen never makes the minimum larger than the maximum.
    const tiny = chatSizeLimits({ width: 300, height: 300 })
    expect(tiny.min.width).toBeLessThanOrEqual(tiny.max.width)
    expect(tiny.min.height).toBeLessThanOrEqual(tiny.max.height)
    expect(clampChatSize({ width: 500, height: 500 }, DISPLAY.workArea)).toEqual({
      width: 500,
      height: 500,
    })
    expect(
      sameRect({ x: 0, y: 0, width: 380, height: 520 }, { x: 1, y: 0, width: 381, height: 520 }),
    ).toBe(true)
    expect(
      sameRect({ x: 0, y: 0, width: 380, height: 520 }, { x: 0, y: 0, width: 420, height: 520 }),
    ).toBe(false)
  })

  it('the chat is dragged by its header; the header buttons stay clickable', () => {
    const file = resolve(__dirname, '../../renderer/surfaces/askbar/askbar.css')
    const css = readFileSync(file, 'utf8').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.ask__head \{[^}]*-webkit-app-region: drag;/)
    expect(css).toMatch(/\.ask__head button \{[^}]*-webkit-app-region: no-drag;/)
  })

  it('stores chat spots per display in a file, ignoring bad entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-spots-'))
    try {
      const file = join(dir, 'chat-spots.json')
      const store = fileChatSpotStore(file)
      expect(store.load()).toEqual({})
      store.save({ '1': { x: 10, y: 20 } })
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ '1': { x: 10, y: 20 } })
      expect(fileChatSpotStore(file).load()).toEqual({ '1': { x: 10, y: 20 } })
      // The size comes back with the spot; a half or bad size is dropped, the spot kept.
      store.save({
        '1': { x: 10, y: 20, width: 500, height: 600 },
        '2': { x: 5, y: 6, width: 0, height: 600 },
      })
      expect(fileChatSpotStore(file).load()).toEqual({
        '1': { x: 10, y: 20, width: 500, height: 600 },
        '2': { x: 5, y: 6 },
      })
      const mem = memoryChatSpotStore({ '2': { x: 1, y: 2 } })
      mem.save({ '2': { x: 3, y: 4 } })
      expect(mem.load()).toEqual({ '2': { x: 3, y: 4 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('grows a window from its top edge around the same centre', () => {
    const grown = resizeKeepingTop({ x: 476, y: 240, width: 560, height: 52 }, 560, 300, wa)
    expect(grown).toEqual({ x: 476, y: 240, width: 560, height: 300 })
    const huge = resizeKeepingTop({ x: 476, y: 900, width: 560, height: 52 }, 560, 400, wa)
    expect(huge.y + huge.height).toBeLessThanOrEqual(wa.y + wa.height - 8)
  })
})
