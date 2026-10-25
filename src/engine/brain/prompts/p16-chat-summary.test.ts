import { describe, expect, it } from 'vitest'
import { CHAT_SUMMARY_MAX_WORDS, chatSummaryPrompt } from './p16-chat-summary'

const ctx = { onDevice: false, today: '2026-10-25 (Sunday)' }

describe('P16 chat summary', () => {
  it('folds the older turns into the summary so far, on the cheap tier', () => {
    const built = chatSummaryPrompt.build(
      {
        previous: 'The student asked for a chemistry course.',
        transcript: 'Student: hi\n\nDumbledore: Done: Created subject “Chemistry”',
      },
      ctx,
    )
    expect(chatSummaryPrompt.tier).toBe('triage')
    expect(built.system).toContain('Undone by the student:')
    expect(built.user).toContain('<summary_so_far>\nThe student asked for a chemistry course.')
    expect(built.user).toContain('Done: Created subject “Chemistry”')
    expect(chatSummaryPrompt.build({ previous: '', transcript: 'x' }, ctx).user).toContain(
      '(none yet)',
    )
  })

  it('keeps the summary short', () => {
    const long = 'word '.repeat(500)
    const out = chatSummaryPrompt.finalize({ summary: long }, { previous: '', transcript: '' })
    expect(out.summary.split(/\s+/).length).toBeLessThanOrEqual(CHAT_SUMMARY_MAX_WORDS + 41)
    expect(
      chatSummaryPrompt.check?.({ summary: long }, { previous: '', transcript: '' }),
    ).toHaveLength(1)
  })
})
