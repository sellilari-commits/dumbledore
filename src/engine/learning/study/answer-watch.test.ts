import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../../clock'
import { AnswerWatch, answerAfterPrompt, hasAnswer } from './answer-watch'

const PROMPT =
  'Explain the SN1 mechanism step by step: why does a tertiary carbocation form first, and how does the solvent help?'
const ANSWER =
  'In SN1 the leaving group departs first, giving a carbocation. Tertiary carbocations are the most stable because hyperconjugation spreads the positive charge. Polar protic solvents stabilise both the ion and the leaving group.'

const chat = (...blocks: string[]) => blocks.join('\n\n')

describe('answerAfterPrompt', () => {
  it('returns the assistant text after the pasted prompt', () => {
    const excerpt = chat('ChatGPT: Hi! How can I help?', `Student: ${PROMPT}`, `ChatGPT: ${ANSWER}`)
    expect(answerAfterPrompt(excerpt, PROMPT, 'ChatGPT')).toBe(ANSWER)
    expect(hasAnswer(excerpt, PROMPT, 'ChatGPT')).toBe(true)
  })

  it('finds a prompt shown wrapped or cut off on screen', () => {
    const shown = `${PROMPT.slice(0, 70)}\n${PROMPT.slice(70, 100)}…`
    const excerpt = chat(`Student: ${shown}`, `ChatGPT: ${ANSWER}`)
    expect(answerAfterPrompt(excerpt, PROMPT, 'ChatGPT')).toBe(ANSWER)
  })

  it('is empty while the prompt has no answer yet, or the chat shows another conversation', () => {
    expect(answerAfterPrompt(chat(`Student: ${PROMPT}`), PROMPT, 'ChatGPT')).toBe('')
    expect(
      answerAfterPrompt(chat('Student: what is osmosis', `ChatGPT: ${ANSWER}`), PROMPT, 'ChatGPT'),
    ).toBe('')
    expect(answerAfterPrompt('', PROMPT, 'ChatGPT')).toBe('')
  })

  it('ignores the answer to an earlier prompt and a short partial reply', () => {
    const excerpt = chat(
      `Student: older question`,
      `ChatGPT: ${ANSWER}`,
      `Student: ${PROMPT}`,
      'ChatGPT: In SN1',
    )
    expect(answerAfterPrompt(excerpt, PROMPT, 'ChatGPT')).toBe('In SN1')
    expect(hasAnswer(excerpt, PROMPT, 'ChatGPT')).toBe(false)
  })

  it('works without roles, when prompt and answer share one block', () => {
    const excerpt = `${PROMPT}\n${ANSWER}`
    expect(answerAfterPrompt(excerpt, PROMPT, null).length).toBeGreaterThan(120)
  })
})

describe('AnswerWatch', () => {
  const setup = () => {
    const clock = new FakeClock()
    let text = chat(`Student: ${PROMPT}`)
    const answered = vi.fn()
    const watch = new AnswerWatch(clock, () => text, answered)
    watch.start({ itemId: 'itm_1', prompt: PROMPT, assistant: 'ChatGPT' })
    return { clock, answered, watch, say: (t: string) => (text = t) }
  }

  it('waits while the answer is still streaming, then fires once it is stable', () => {
    const t = setup()
    t.clock.advance(4000)
    expect(t.answered).not.toHaveBeenCalled()
    t.say(chat(`Student: ${PROMPT}`, `ChatGPT: ${ANSWER.slice(0, 130)}`))
    t.clock.advance(2000)
    t.say(chat(`Student: ${PROMPT}`, `ChatGPT: ${ANSWER}`))
    t.clock.advance(2000)
    expect(t.answered).not.toHaveBeenCalled() // still growing
    t.clock.advance(2000)
    expect(t.answered).toHaveBeenCalledWith('itm_1')
    expect(t.watch.watching).toBeNull()
    t.clock.advance(10_000)
    expect(t.answered).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a live chat feed', () => {
    const clock = new FakeClock()
    const answered = vi.fn()
    const watch = new AnswerWatch(clock, null, answered)
    watch.start({ itemId: 'itm_1', prompt: PROMPT, assistant: 'ChatGPT' })
    clock.advance(10_000)
    expect(answered).not.toHaveBeenCalled()
    expect(watch.watching).toBeNull()
  })

  it('stop() cancels the poll', () => {
    const t = setup()
    t.watch.stop()
    t.say(chat(`Student: ${PROMPT}`, `ChatGPT: ${ANSWER}`))
    t.clock.advance(10_000)
    expect(t.answered).not.toHaveBeenCalled()
    expect(t.clock.pendingTimers()).toBe(0)
  })
})
