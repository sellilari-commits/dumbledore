/**
 * The shortcut decision table (PLAN §4 D8, §5.3 F4, §5.6), as a pure function.
 *
 * Short press = the prompt (Ilari, 2026-10-24). A right-⌥ tap resolves in order (an orb click only
 * toggles the mini panel, see ShortcutRouter.orbClick): ask bar
 * / quiz card open → Enter · password field → refuse · in the AI-chat box: `/d …` line →
 * instruction, the student's own text → rewrite it in place (also during a session), empty → the
 * next step of a running session, else study the subject worked on last · (a) session in an AI
 * chat → next step · (b) `/d …` line in another field → instruction · (c) selection → actions
 * toast · (d) AI chat open → study the subject worked on last · (e) else → toggle the mini panel.
 * A click on the suggestion chip is a tap, except that it inserts the suggested prompt into an
 * empty box.
 *
 * Long press (holdStart) opens the prompt box: the ask bar with route 'prompt', where the student
 * says what they want and Dumbledore writes the prompt and pastes it into the AI chat (the
 * 'prompt.write' channel). Double-tap opens the chat with Dumbledore, plain. Both focus the ask
 * bar when it is already open. A quiz card swallows the hold. holdEnd → nothing.
 *
 * The field value and the selection are read from the helper only on an explicit gesture, and
 * only when the table needs them: `decide` returns `need` until the caller supplies them.
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

/** What the student did: a trigger-key gesture, or a click on the suggestion chip. */
export type RouteInput = Gesture | 'chip'

export type Decision =
  | { kind: 'ignore' }
  | { kind: 'askbar' }
  | { kind: 'focusAskbar' }
  /** The prompt box: the ask bar with route 'prompt' ("tell Dumbledore what you want"). */
  | { kind: 'promptBox' }
  /** Resume or start the subject worked on last (the router finds it). */
  | { kind: 'studyLast' }
  | { kind: 'enter'; surface: 'askbar' | 'overlay' }
  | { kind: 'refuseSecure' }
  | { kind: 'sessionNext' }
  | { kind: 'instruction'; text: string; wholeField: boolean }
  | { kind: 'suggest' }
  | { kind: 'improve'; draft: string }
  | { kind: 'unreadable' }
  | { kind: 'selection'; text: string }
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

export function decide(input: RouteInput, ctx: RouteContext): Decision {
  switch (input) {
    case 'holdEnd':
      return { kind: 'ignore' }
    case 'doubleTap':
      return ctx.askbarOpen ? { kind: 'focusAskbar' } : { kind: 'askbar' }
    case 'holdStart':
      return decideHold(ctx)
    default:
      return decideTap(input, ctx)
  }
}

const isSecure = (ctx: RouteContext) => ctx.secureInput || ctx.focused?.secure === true

const inChatBox = (ctx: RouteContext) =>
  ctx.aiChat !== null && ctx.focused !== null && ctx.focused.pid === ctx.aiChat.pid

/** The field text after the `/d` check: the draft, unreadable, or empty. */
function draftOf(ctx: RouteContext): { draft: string } | 'unreadable' | 'empty' {
  const draft = ctx.fieldText?.trim() ?? ''
  if (draft) return { draft }
  if (ctx.fieldText === null && (ctx.focused?.valueLength ?? 0) > 0) return 'unreadable'
  return 'empty'
}

function decideHold(ctx: RouteContext): Decision {
  if (ctx.quizOpen) return { kind: 'ignore' }
  return ctx.askbarOpen ? { kind: 'focusAskbar' } : { kind: 'promptBox' }
}

function decideTap(input: 'tap' | 'chip', ctx: RouteContext): Decision {
  if (ctx.askbarOpen) return { kind: 'enter', surface: 'askbar' }
  if (ctx.quizOpen) return { kind: 'enter', surface: 'overlay' }
  if (isSecure(ctx)) return { kind: 'refuseSecure' }

  const chat = ctx.aiChat
  if (ctx.focused?.editable && inChatBox(ctx)) {
    if (ctx.fieldText === undefined) return { kind: 'need', what: 'fieldText' }
    const line = instructionLine(ctx.fieldText)
    if (line) return { kind: 'instruction', text: line.text, wholeField: line.wholeField }
    const d = draftOf(ctx)
    if (d === 'unreadable') return { kind: 'unreadable' }
    if (d !== 'empty') return { kind: 'improve', draft: d.draft }
    if (ctx.sessionActive) return { kind: 'sessionNext' }
    return input === 'chip' ? { kind: 'suggest' } : { kind: 'studyLast' }
  }

  if (ctx.sessionActive && chat) return { kind: 'sessionNext' }

  if (ctx.focused?.editable) {
    if (ctx.fieldText === undefined) return { kind: 'need', what: 'fieldText' }
    const line = instructionLine(ctx.fieldText)
    if (line) return { kind: 'instruction', text: line.text, wholeField: line.wholeField }
  }

  if (ctx.selection === undefined) return { kind: 'need', what: 'selection' }
  const selection = ctx.selection?.trim()
  if (selection) return { kind: 'selection', text: selection }
  if (chat) return { kind: 'studyLast' }
  return { kind: 'togglePanel' }
}
