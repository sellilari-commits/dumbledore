/**
 * Errors the student reads. Electron wraps every failed invoke as "Error invoking remote method
 * 'dd:invoke:…': SomeError: text"; `cleanError` keeps only the text. When the AI didn't answer
 * (a timeout, a cancelled request, no provider left, the spending cap), the text says why and
 * what fixes it, and
 * `errorToast` adds a button to the AI settings.
 */
import { toast } from '@renderer/design-system'
import { AI_OVER_BUDGET_TEXT, AI_UNAVAILABLE_TEXT, aiFailureText } from '@shared/ai-errors'

export { AI_OVER_BUDGET_TEXT, AI_UNAVAILABLE_TEXT }

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
  const ai = aiFailureText(text)
  return ai ? new AppError(ai, true) : new AppError(text, false)
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
