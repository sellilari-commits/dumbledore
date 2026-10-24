/**
 * Size of the double-tap chat with Dumbledore: a box beside the orb, 380 × 520 pt the first time.
 * It never grows or shrinks with the conversation (the thread scrolls inside); the student can
 * resize it by its edges within CHAT_MIN_* and CHAT_MAX_WIDTH × the screen, and main remembers the
 * size per display. Only a short screen makes the default smaller. Main owns the window's size.
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

/** The smallest and widest the student can resize the chat to (pt). */
export const CHAT_MIN_WIDTH = 320
export const CHAT_MIN_HEIGHT = 360
export const CHAT_MAX_WIDTH = 900

type Size = { width: number; height: number }

/**
 * Resize limits on a work area this big: 320 × 360 up to 900 wide and the area's height, both less
 * the margin. On a tiny screen the minimum shrinks so it never exceeds the maximum.
 */
export function chatSizeLimits(area: Size): { min: Size; max: Size } {
  const inArea = (v: number, cap: number) =>
    v > 0 ? Math.max(1, Math.floor(v - SCREEN_MARGIN)) : cap
  const max = {
    width: Math.min(CHAT_MAX_WIDTH, inArea(area.width, CHAT_MAX_WIDTH)),
    height: inArea(area.height, 2000),
  }
  const min = {
    width: Math.min(CHAT_MIN_WIDTH, max.width),
    height: Math.min(CHAT_MIN_HEIGHT, max.height),
  }
  return { min, max }
}

/** A size the student chose, kept within the limits of this work area. */
export function clampChatSize(size: Size, area: Size): Size {
  const { min, max } = chatSizeLimits(area)
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), hi))
  return {
    width: clamp(size.width, min.width, max.width),
    height: clamp(size.height, min.height, max.height),
  }
}

/** The Ask bar's study box (right ⌥ hold) opens on route 'prompt'; every other route is the chat. */
export function isPromptRoute(route: string | null | undefined): boolean {
  return (route ?? '').replace(/^#?\/?/, '').split(/[?#]/)[0] === 'prompt'
}
