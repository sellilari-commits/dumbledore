/**
 * Where windows open, pure maths in global points: the panel beside the orb (toward the screen
 * centre), the double-tap chat as a tall panel beside the orb, the study box centred on the active
 * display or over the focused field, and resizing that keeps a window's top edge and horizontal
 * centre in place.
 */
import { chatPanelSize, isPromptRoute } from '@shared/chat-panel'
import type { Rect } from '@shared/geometry'
import { type DisplayInfo, ORB_SIZE, type OrbSpot } from '../overlay/geometry'

export const PANEL_SIZE = { width: 380, height: 580 }
export const ASKBAR_SIZE = { width: 560, height: 52 }
const MARGIN = 8
const GAP = 12

export function clampRect(r: Rect, area: Rect, margin = MARGIN): Rect {
  const width = Math.min(r.width, area.width - 2 * margin)
  const height = Math.min(r.height, area.height - 2 * margin)
  const x = Math.min(Math.max(r.x, area.x + margin), area.x + area.width - margin - width)
  const y = Math.min(Math.max(r.y, area.y + margin), area.y + area.height - margin - height)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/**
 * Size the panel opens at: the mini panel reopens at the size it last fitted to (its content
 * asks for it, see usePanelAutoSize); the study picker always gets the full PANEL_SIZE.
 */
export function panelOpenSize(
  route: string | null,
  fitted: { width: number; height: number } | null,
): { width: number; height: number } {
  if (route?.startsWith('/picker') || !fitted) return PANEL_SIZE
  return fitted
}

/** The panel opens beside the orb, on the side facing the middle of the screen. */
export function panelBounds(d: DisplayInfo, orb: OrbSpot, size = PANEL_SIZE): Rect {
  const ox = d.bounds.x + orb.x
  const oy = d.bounds.y + orb.y
  const r = ORB_SIZE / 2
  let x: number
  let y: number
  if (orb.edge === 'top' || orb.edge === 'bottom') {
    x = ox - size.width / 2
    y = orb.edge === 'top' ? oy + r + GAP : oy - r - GAP - size.height
  } else {
    const onRight = orb.x > d.bounds.width / 2
    x = onRight ? ox - r - GAP - size.width : ox + r + GAP
    y = oy - size.height / 2
  }
  return clampRect({ x, y, width: size.width, height: size.height }, d.workArea)
}

/**
 * The double-tap chat: a tall, narrow panel beside the orb (the side facing the middle of the
 * screen), vertically centred on it and kept on screen; it never covers the orb. Without an orb
 * spot it stands at the right edge of the work area, vertically centred.
 */
export function chatBounds(d: DisplayInfo, orb: OrbSpot | null): Rect {
  const size = chatPanelSize(d.workArea.height)
  if (orb && orb.displayId === d.id) return panelBounds(d, orb, size)
  const wa = d.workArea
  const x = wa.x + wa.width - size.width - MARGIN - ORB_SIZE - GAP
  const y = wa.y + (wa.height - size.height) / 2
  return clampRect({ x, y, width: size.width, height: size.height }, wa)
}

/** The study box sits over the focused field when there is one, else high on the active display. */
export function askbarBounds(d: DisplayInfo, nearField: Rect | null, size = ASKBAR_SIZE): Rect {
  const wa = d.workArea
  if (nearField) {
    const x = nearField.x + nearField.width / 2 - size.width / 2
    let y = nearField.y - size.height - MARGIN
    if (y < wa.y + MARGIN) y = nearField.y + nearField.height + MARGIN
    return clampRect({ x, y, width: size.width, height: size.height }, wa)
  }
  const x = wa.x + (wa.width - size.width) / 2
  const y = wa.y + Math.round(wa.height * 0.22)
  return clampRect({ x, y, width: size.width, height: size.height }, wa)
}

/**
 * Where the Ask bar opens, decided before it is shown so the first frame already has its size:
 * the double-tap chat as a tall panel beside the orb, the study box (route 'prompt') as the
 * compact bar over the focused field or high on the display.
 */
export function askbarOpenBounds(
  d: DisplayInfo,
  route: string | null | undefined,
  orb: OrbSpot | null,
  nearField: Rect | null,
): Rect {
  return isPromptRoute(route) ? askbarBounds(d, nearField) : chatBounds(d, orb)
}

/** New size for a window that grows with its content: top edge and centre stay put. */
export function resizeKeepingTop(current: Rect, width: number, height: number, area: Rect): Rect {
  const x = current.x + current.width / 2 - width / 2
  return clampRect({ x, y: current.y, width, height }, area)
}
