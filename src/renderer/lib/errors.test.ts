import { describe, expect, it } from 'vitest'
import { AI_OVER_BUDGET_TEXT, AI_UNAVAILABLE_TEXT, cleanError, cleanMessage } from './errors'

describe('errors', () => {
  it('strips Electron’s invoke wrapper and the error class', () => {
    expect(
      cleanMessage(
        "Error invoking remote method 'dd:invoke:subjects.create': ValidationError: Name is required",
      ),
    ).toBe('Name is required')
  })

  it('explains an AI timeout and how to fix it', () => {
    const e = cleanError(
      new Error(
        "Error invoking remote method 'dd:invoke:coach.runAction': StudyError: Couldn't build a roadmap: brain task \"buildRoadmap\" timed out",
      ),
    )
    expect(e.aiUnavailable).toBe(true)
    expect(e.message).toBe(AI_UNAVAILABLE_TEXT)
  })

  it('maps the router’s "unavailable" to plain words, and names the spending cap', () => {
    const down = cleanError(
      new Error(
        'BrainUnavailableError: brain task "outline" unavailable: ovh: timed out; gemini: no key',
      ),
    )
    expect(down.message).toBe(AI_UNAVAILABLE_TEXT)
    const capped = cleanError(
      new Error('brain task "outline" unavailable: gemini: over-budget; ovh: timed out'),
    )
    expect(capped).toMatchObject({ message: AI_OVER_BUDGET_TEXT, aiUnavailable: true })
  })

  it('keeps other messages as they are', () => {
    const e = cleanError(new Error('Subject not found'))
    expect(e.aiUnavailable).toBe(false)
    expect(e.message).toBe('Subject not found')
  })
})
