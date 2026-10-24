/**
 * Errors the student reads. Electron wraps every failed invoke as "Error invoking remote method
 * 'dd:invoke:…': SomeError: text"; `cleanError` keeps only the text. When the AI didn't answer
 * (a timeout, a cancelled request, no provider left, the spending cap), the text says why and
 * what fixes it, and
 * `errorToast` adds a button to the AI settings.
 */
import { toast } from '@renderer/design-system'

const AI_DOWN =
  /timed out|aborted|request cancelled|all providers|no provider|rate limit|429|task "[^"]*" unavailable|over-budget/i
const OVER_BUDGET = /over-budget/i

export const AI_UNAVAILABLE_TEXT =
  'Dumbledore’s AI didn’t answer in time. Without an AI key it uses a slow free service — add a Gemini key in Settings → AI providers for fast answers.'

/** The Gemini key is there, but the spending cap (DUMBLEDORE_BUDGET_EUR, €10) is reached. */
export const AI_OVER_BUDGET_TEXT =
  'Dumbledore’s AI spending cap is reached, so it used the slow free service, which didn’t answer. Try again in a moment.'

export class AppError extends Error {
  constructor(
    message: string,
    readonly aiUnavailable: boolean,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** "Error invoking remote method 'x': StudyError: Couldn't …" → "Couldn't …". */
export function cleanMessage(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/, '')
    .trim()
}

export function cleanError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const raw = err instanceof Error ? err.message : String(err)
  const text = cleanMessage(raw)
  if (OVER_BUDGET.test(text)) return new AppError(AI_OVER_BUDGET_TEXT, true)
  return AI_DOWN.test(text) ? new AppError(AI_UNAVAILABLE_TEXT, true) : new AppError(text, false)
}

/** An error toast in plain words; an AI outage gets "Open AI settings". */
export function errorToast(err: unknown): void {
  const e = cleanError(err)
  toast(e.message, {
    tone: 'error',
    ttlMs: e.aiUnavailable ? 10_000 : 6_000,
    action: e.aiUnavailable
      ? {
          label: 'Open AI settings',
          onClick: () => {
            window.location.hash = '#/settings/ai'
          },
        }
      : undefined,
  })
}
