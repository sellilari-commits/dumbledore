import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DISPLAY } from '../testing/harness'
import {
  askbarBounds,
  clampRect,
  PANEL_SIZE,
  panelBounds,
  panelOpenSize,
  resizeKeepingTop,
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

  it('grows a window from its top edge around the same centre', () => {
    const grown = resizeKeepingTop({ x: 476, y: 240, width: 560, height: 52 }, 560, 300, wa)
    expect(grown).toEqual({ x: 476, y: 240, width: 560, height: 300 })
    const huge = resizeKeepingTop({ x: 476, y: 900, width: 560, height: 52 }, 560, 400, wa)
    expect(huge.y + huge.height).toBeLessThanOrEqual(wa.y + wa.height - 8)
  })
})
