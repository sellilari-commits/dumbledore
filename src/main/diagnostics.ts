/**
 * Development diagnostics: renderer problems show up in the terminal that runs `npm run dev`
 * (and in E2E logs). A failed page load, a failed preload — which would leave a page without
 * `window.dumbledore`, and the overlay quietly on its mock driver — and console errors/warnings.
 * Not wired in packaged builds.
 */
import type { WebContents } from 'electron'

/** "http://localhost:5173/overlay.html?display=1" → "overlay". */
function label(contents: WebContents): string {
  const url = contents.getURL()
  return /\/(\w+)\.html/.exec(url)?.[1] ?? (url || 'renderer')
}

export function watchRenderer(contents: WebContents): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[${label(contents)}] preload failed (${preloadPath}):`, error)
  })
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame)
      console.error(`[${label(contents)}] load failed ${code} ${description}: ${url}`)
  })
  contents.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') return
    const where = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : ''
    console.warn(`[${label(contents)}] console ${details.level}: ${details.message}${where}`)
  })
}
