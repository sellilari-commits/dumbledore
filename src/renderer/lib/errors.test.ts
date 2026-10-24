import { describe, expect, it } from 'vitest'
import { AI_UNAVAILABLE_TEXT, cleanError, cleanMessage } from './errors'

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

  it('keeps other messages as they are', () => {
    const e = cleanError(new Error('Subject not found'))
    expect(e.aiUnavailable).toBe(false)
    expect(e.message).toBe('Subject not found')
  })
})
