/**
 * The `dumbledore://renderer/` protocol: serves the built renderer files in production with the
 * strict CSP as a real response header (file:// loads cannot carry one). Paths are confined to
 * the renderer folder. The scheme must be registered as privileged before the app is ready.
 */
import { readFile } from 'node:fs/promises'
import { extname, normalize, resolve, sep } from 'node:path'
import { protocol } from 'electron'
import { APP_SCHEME, PROD_CSP, RENDERER_HOST } from './urls'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

export function mimeType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Maps a protocol URL to a file inside `root`; null for other hosts or path escapes. */
export function resolveRendererPath(root: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== RENDERER_HOST) return null
  let rel: string
  try {
    rel = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  const base = resolve(root)
  const file = normalize(resolve(base, `.${rel.startsWith('/') ? rel : `/${rel}`}`))
  if (file !== base && !file.startsWith(base + sep)) return null
  return file === base ? resolve(base, 'index.html') : file
}

export function responseHeaders(path: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': mimeType(path),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  }
  if (path.endsWith('.html')) headers['Content-Security-Policy'] = PROD_CSP
  return headers
}

/** Call before `app.whenReady()`. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ])
}

/** Call after ready: serves files from `root` (out/renderer). */
export function serveRenderer(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveRendererPath(root, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, { status: 200, headers: responseHeaders(file) })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
