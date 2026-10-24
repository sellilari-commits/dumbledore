/**
 * Size of the double-tap chat with Dumbledore: a fixed, constant box beside the orb (380 × 520 pt).
 * It opens at exactly this size every time and never grows or shrinks with the conversation; the
 * thread scrolls inside and empty space is fine. Only a short screen makes it smaller. Main places
 * the window with it and the Ask bar asks for the same size, so both sides agree.
 */
export const CHAT_PANEL_WIDTH = 380
export const CHAT_PANEL_HEIGHT = 520
/** Room kept free on a short screen (main keeps windows 8 pt inside the work area). */
const SCREEN_MARGIN = 16

/** The panel's height on a screen (or work area) this tall: 520 pt, less only on a short screen. */
export function chatPanelHeight(screenHeight: number): number {
  if (!(screenHeight > 0)) return CHAT_PANEL_HEIGHT
  return Math.min(CHAT_PANEL_HEIGHT, Math.floor(screenHeight - SCREEN_MARGIN))
}

export function chatPanelSize(screenHeight: number): { width: number; height: number } {
  return { width: CHAT_PANEL_WIDTH, height: chatPanelHeight(screenHeight) }
}

/** The Ask bar's study box (right ⌥ hold) opens on route 'prompt'; every other route is the chat. */
export function isPromptRoute(route: string | null | undefined): boolean {
  return (route ?? '').replace(/^#?\/?/, '').split(/[?#]/)[0] === 'prompt'
}
