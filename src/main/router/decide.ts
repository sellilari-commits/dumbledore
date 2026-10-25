/**
 * The shortcut decision table (PLAN §4 D8, §5.3 F4, §5.6), as a pure function. Three gestures, one
 * job each (Olle, 2026-10-25):
 *
 *   Tap         = the quick, smart prompt. In order: ask bar / quiz card open → Enter · password
 *                 field → refuse · in the AI-chat box: `/d …` line → instruction, the student's own
 *                 text → rewrite it in place, empty → the session's next step, else the best next
 *                 prompt (suggest) · session in an AI chat → next step · `/d …` line in another
 *                 field → instruction · selection → actions toast · mini panel open → close it ·
 *                 AI chat open → the best next prompt · else → toggle the mini panel.
 *                 A tap never starts a roadmap and never outlines.
 *   Hold        = the longer job on what is on screen: outline what to read, on an article, a PDF
 *                 or an AI chat's answers (even with the cursor in the chat box); a hold while the
 *                 marks show clears them. A quiz card swallows it; an open ask bar takes focus.
 *   Double-tap  = knock on Dumbledore's door: the chat with Dumbledore (talk, ask, plan studying),
 *                 and again to close it (from the study box it switches to the chat).
 *
 * A click on the suggestion chip is a tap. holdEnd → nothing. An orb click only toggles the mini
 * panel (ShortcutRouter.orbClick).
 *
 * The field value and the selection are read from the helper only on an explicit gesture, and
 * only when the table needs them: `decide` returns `need` until the caller supplies them.
 */
import type { Gesture } from '@shared/helper-protocol'

export interface RouteContext {
  askbarOpen: boolean
  /** What the open ask bar shows: the double-tap chat or the study box (undefined = the chat). */
  askbarRoute?: 'chat' | 'prompt' | null
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
  /** The mini panel is open: a tap outside a chat box closes it again. */
  panelOpen?: boolean
  /** Outline marks are showing over the page (a hold clears them). */
  outlineShown?: boolean
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
  /** Double-tap while the chat is open: it closes (a toggle). */
  | { kind: 'closeAskbar' }
  | { kind: 'enter'; surface: 'askbar' | 'overlay' }
  | { kind: 'refuseSecure' }
  | { kind: 'sessionNext' }
  | { kind: 'instruction'; text: string; wholeField: boolean }
  | { kind: 'suggest' }
  | { kind: 'improve'; draft: string }
  | { kind: 'unreadable' }
  | { kind: 'selection'; text: string }
  | { kind: 'togglePanel' }
  | { kind: 'outline' }
  | { kind: 'clearOutline' }
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
      // A toggle: the open chat closes; the study box switches to the chat; else the chat opens.
      if (!ctx.askbarOpen) return { kind: 'askbar' }
      return ctx.askbarRoute === 'prompt' ? { kind: 'focusAskbar' } : { kind: 'closeAskbar' }
    case 'holdStart':
      return decideHold(ctx)
    default:
      return decideTap(ctx)
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
  if (ctx.askbarOpen) return { kind: 'focusAskbar' }
  return ctx.outlineShown ? { kind: 'clearOutline' } : { kind: 'outline' }
}

/** A tap and a chip click decide alike. */
function decideTap(ctx: RouteContext): Decision {
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
    return ctx.sessionActive ? { kind: 'sessionNext' } : { kind: 'suggest' }
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
  if (ctx.panelOpen) return { kind: 'togglePanel' }
  if (chat) return { kind: 'suggest' }
  return { kind: 'togglePanel' }
}
