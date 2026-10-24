/**
 * The shortcut decision table (PLAN §5.3 F4, §5.6), as a pure function.
 *
 * A tap resolves in order: ask bar / quiz card open → Enter · password field → refuse ·
 * (a) session in an AI chat → next step · (b) `/d …` line in the field → instruction ·
 * (c) AI-chat box: empty → suggest, text → improve · (d) selection → actions toast ·
 * (e) AI chat open → picker · (f) else → toggle the mini panel. Hold or double-tap → ask bar.
 *
 * The field value and the selection are read from the helper only on an explicit tap, and only
 * when the table needs them: `decide` returns `need` until the caller supplies them.
 */
import type { Gesture } from '@shared/helper-protocol'

export interface RouteContext {
  askbarOpen: boolean
  quizOpen: boolean
  /** A study session is running (phase step / checkpoint / planning). */
  sessionActive: boolean
  aiChat: { pid: number } | null
  focused: {
    pid: number
    editable: boolean
    secure: boolean
    valueLength: number | null
  } | null
  /** The helper reported secure keyboard input (e.g. a password prompt). */
  secureInput: boolean
  /** undefined = not read yet; null = could not be read. */
  fieldText?: string | null
  selection?: string | null
}

export type Decision =
  | { kind: 'ignore' }
  | { kind: 'askbar' }
  | { kind: 'enter'; surface: 'askbar' | 'overlay' }
  | { kind: 'refuseSecure' }
  | { kind: 'sessionNext' }
  | { kind: 'instruction'; text: string; wholeField: boolean }
  | { kind: 'suggest' }
  | { kind: 'improve'; draft: string }
  | { kind: 'unreadable' }
  | { kind: 'selection'; text: string }
  | { kind: 'picker' }
  | { kind: 'togglePanel' }
  | { kind: 'need'; what: 'fieldText' | 'selection' }

const INSTRUCTION = /^\s*\/d\s+(\S.*)$/

/** The last line starting with `/d `, and whether it is the field's only non-empty line. */
export function instructionLine(text: string | null | undefined): {
  text: string
  wholeField: boolean
} | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = INSTRUCTION.exec(lines[i] ?? '')
    if (match?.[1]) {
      const nonEmpty = lines.filter((l) => l.trim() !== '').length
      return { text: match[1].trim(), wholeField: nonEmpty === 1 }
    }
  }
  return null
}

export function decide(gesture: Gesture, ctx: RouteContext): Decision {
  if (gesture === 'holdEnd') return { kind: 'ignore' }
  if (gesture === 'holdStart' || gesture === 'doubleTap') {
    return ctx.askbarOpen ? { kind: 'ignore' } : { kind: 'askbar' }
  }
  if (ctx.askbarOpen) return { kind: 'enter', surface: 'askbar' }
  if (ctx.quizOpen) return { kind: 'enter', surface: 'overlay' }
  if (ctx.secureInput || ctx.focused?.secure) return { kind: 'refuseSecure' }

  const chat = ctx.aiChat
  if (ctx.sessionActive && chat) return { kind: 'sessionNext' }

  const focused = ctx.focused
  if (focused?.editable) {
    if (ctx.fieldText === undefined) return { kind: 'need', what: 'fieldText' }
    const line = instructionLine(ctx.fieldText)
    if (line) return { kind: 'instruction', text: line.text, wholeField: line.wholeField }
    if (chat && focused.pid === chat.pid) {
      const draft = ctx.fieldText?.trim() ?? ''
      if (draft) return { kind: 'improve', draft }
      if (ctx.fieldText === null && (focused.valueLength ?? 0) > 0) return { kind: 'unreadable' }
      return { kind: 'suggest' }
    }
  }

  if (ctx.selection === undefined) return { kind: 'need', what: 'selection' }
  const selection = ctx.selection?.trim()
  if (selection) return { kind: 'selection', text: selection }
  if (chat) return { kind: 'picker' }
  return { kind: 'togglePanel' }
}
