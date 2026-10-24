/**
 * Renderer hardening (PLAN §6.9): every webContents gets no new windows (target=_blank and
 * window.open go to the default browser via shell.openExternal), no navigation away from our
 * own pages and no webviews. The default session grants no permissions except sanitized
 * clipboard writes, and serves our pages with the strict CSP (dev: as a header on the dev
 * server's responses; production: through the dumbledore:// protocol).
 */
import { session, shell, type WebContents } from 'electron'
import { serveRenderer } from './windows/protocol'
import { devCsp, isExternalLink, isOwnUrl, rendererBase } from './windows/urls'

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

function openOutside(url: string): void {
  if (!isExternalLink(url)) return
  shell.openExternal(url).catch((error: unknown) => console.warn('[links] cannot open', error))
}

export function harden(contents: WebContents, devUrl: string | null): void {
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isOwnUrl(url, devUrl)) return
    event.preventDefault()
    openOutside(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/** `rendererDir` is out/renderer, used when there is no dev server. */
export function configureSession(devUrl: string | null, rendererDir: string): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  )
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  if (devUrl) {
    const csp = devCsp(devUrl)
    ses.webRequest.onHeadersReceived({ urls: [`${rendererBase(devUrl)}/*`] }, (details, done) => {
      done({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
  } else {
    serveRenderer(rendererDir)
  }
}
