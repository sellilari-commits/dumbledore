/**
 * Chat tools: the double-tap chat's general access to everything Dumbledore knows about the
 * student. A handful of generic tools instead of one per operation:
 * - read(kind, id?, filter?) and search(query): any kind of record (read.ts)
 * - create(kind, data), update(kind, id, patch), delete(kind, id): row edits on the writable
 *   kinds; every write snapshots what it touches first, so it comes back with a receipt and an
 *   Undo that restores the snapshot; delete only asks for confirmation (a chip) (write.ts)
 * - act(name, args): flows that are more than a row edit, e.g. start or adjust a roadmap, create
 *   an exam, open a page; the app's IPC channels classified as acts are callable too (act.ts)
 * Every call is validated against its zod schema; ids come only from what a read returned.
 */
import type { CoachAction } from '@shared/domain'
import type { z } from 'zod'

/** One line the student sees under the reply ("Renamed “X” → “Y”"), with its Undo when it has one. */
export interface Receipt {
  line: string
  /** UndoLog id; null when the write cannot be undone (the line says why, if it matters). */
  undoId: string | null
}

export interface ToolOutcome {
  /** false when nothing happened (bad input, unknown id, refused); `result` then says why. */
  ok: boolean
  /** JSON-able result the model reads next; keep it compact (the loop clips it anyway). */
  result: unknown
  /** What changed, for the student. */
  receipts: Receipt[]
  /** Chips under the reply: a delete waiting for confirmation, an action the model offered. */
  chips: CoachAction[]
}

export interface ToolCtx {
  signal?: AbortSignal
  /** The student pressed the confirmation chip: a delete runs instead of asking. */
  confirmed?: boolean
}

export interface ChatTool<I = unknown> {
  name: string
  /** What the model reads: when to use it, the kinds or names it takes, what it returns. */
  description: string
  input: z.ZodType<I>
  run(input: I, ctx: ToolCtx): Promise<ToolOutcome> | ToolOutcome
}

/** Builds ChatTool values with the input type inferred from the schema. */
export function defineTool<S extends z.ZodType>(tool: {
  name: string
  description: string
  input: S
  run(input: z.output<S>, ctx: ToolCtx): Promise<ToolOutcome> | ToolOutcome
}): ChatTool<z.output<S>> {
  return tool as ChatTool<z.output<S>>
}

export const outcome = (result: unknown, more: Partial<ToolOutcome> = {}): ToolOutcome => ({
  ok: true,
  result,
  receipts: [],
  chips: [],
  ...more,
})

export const failure = (error: string): ToolOutcome => ({
  ok: false,
  result: { error },
  receipts: [],
  chips: [],
})

/** "a long text…" at `max` characters, whitespace collapsed. */
export function short(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}
