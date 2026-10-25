/**
 * When the AI didn't answer (a timeout, a cancelled request, no provider left, the spending cap),
 * the student reads why and what fixes it, the same words in the app, the chat and the orb. Shared
 * by the renderer's error toasts and main's chat messages.
 */

const AI_DOWN =
  /timed out|aborted|request cancelled|all providers|no provider|rate limit|429|task "[^"]*" unavailable|over-budget/i
const OVER_BUDGET = /over-budget/i

export const AI_UNAVAILABLE_TEXT =
  'Dumbledore’s AI didn’t answer in time. Without an AI key it uses a slow free service — add a Gemini key in Settings → AI providers for fast answers.'

/** The Gemini key is there, but the spending cap (DUMBLEDORE_BUDGET_EUR, €10) is reached. */
export const AI_OVER_BUDGET_TEXT =
  'Dumbledore’s AI spending cap is reached, so it used the slow free service, which didn’t answer. Try again in a moment.'

/** The student's words for an AI failure, or null when the error is something else. */
export function aiFailureText(message: string): string | null {
  if (OVER_BUDGET.test(message)) return AI_OVER_BUDGET_TEXT
  return AI_DOWN.test(message) ? AI_UNAVAILABLE_TEXT : null
}
