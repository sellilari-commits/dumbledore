/**
 * Renderer URLs and the content security policy. In development pages come from the electron-vite
 * dev server (ELECTRON_RENDERER_URL); in production from the `dumbledore://renderer/` protocol,
 * which serves the built files with the CSP header (see protocol.ts).
 */
export const APP_SCHEME = 'dumbledore'
export const RENDERER_HOST = 'renderer'
export const PROD_ORIGIN = `${APP_SCHEME}://${RENDERER_HOST}`

export type Page = 'overlay' | 'panel' | 'askbar' | 'app'

export interface PageUrlOptions {
  query?: Record<string, string>
  /** Hash route, e.g. "/picker" → "#/picker". */
  route?: string | null
}

export function rendererBase(devUrl: string | null): string {
  return (devUrl ?? PROD_ORIGIN).replace(/\/+$/, '')
}

export function pageUrl(page: Page, opts: PageUrlOptions, devUrl: string | null): string {
  const query = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : ''
  const route = opts.route ? `#${opts.route.startsWith('/') ? opts.route : `/${opts.route}`}` : ''
  return `${rendererBase(devUrl)}/${page}.html${query}${route}`
}

/** True for URLs our windows may navigate to (our own pages only). */
export function isOwnUrl(url: string, devUrl: string | null): boolean {
  try {
    const target = new URL(url)
    const base = new URL(rendererBase(devUrl))
    return target.protocol === base.protocol && target.host === base.host
  } catch {
    return false
  }
}

/** Links handed to the default browser or mail app (target=_blank, links in replies). */
export function isExternalLink(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/** Production CSP: our own scripts only, no remote content, no plugins, no framing. */
export const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Development CSP: Vite's dev server needs inline module preambles and its HMR socket. */
export function devCsp(devUrl: string): string {
  const { host } = new URL(devUrl)
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://${host} http://${host}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
