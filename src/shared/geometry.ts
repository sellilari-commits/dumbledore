/**
 * Screen geometry shared by every process.
 *
 * Coordinates are global screen points with the origin at the top-left of the main display and
 * y growing downward. That is the convention of Quartz, the Accessibility API and Electron's
 * `screen` module, so values cross the helper ↔ engine ↔ window boundaries unchanged.
 */
import { z } from 'zod'

export const Point = z.object({ x: z.number(), y: z.number() })
export type Point = z.infer<typeof Point>

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type Rect = z.infer<typeof Rect>

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}
