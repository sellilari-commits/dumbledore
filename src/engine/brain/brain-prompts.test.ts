import { describe, expect, it } from 'vitest'
import type { HelperClient } from '../contracts'
import { checkStudentPrompt, tidyStudentPrompt } from './prompts/shared'
import { brainHarness, R } from './testing/harness'

const goodPrompt =
  "I'm a first-year chemistry student; I know SN2 but carbocations confuse me.\nExplain why tertiary carbocations are more stable:\n1. The main reason\n2. One example\nNo greetings or small talk. Short structured bullets, max ~150 words, bold key terms.\nThen ask me one question to check I got it, and wait."

describe('student-prompt rules', () => {
  it('accepts a good prompt and flags each broken rule', () => {
    expect(checkStudentPrompt(goodPrompt)).toEqual([])
    expect(checkStudentPrompt(`Hello! ${goodPrompt}`).join()).toMatch(/greeting/)
    expect(checkStudentPrompt(goodPrompt.replace(/No greetings.*terms\./, '')).join()).toMatch(
      /brevity/,
    )
    expect(checkStudentPrompt(`${goodPrompt} ${'word '.repeat(80)}`).join()).toMatch(/words/)
    expect(checkStudentPrompt(`Dumbledore says: ${goodPrompt}`).join()).toMatch(/Dumbledore/)
    expect(
      checkStudentPrompt(
        goodPrompt.replace(
          "I'm a first-year chemistry student; I know SN2 but carbocations confuse me.",
          'Carbocations are confusing.',
        ),
      ).join(),
    ).toMatch(/first person/)
  })

  it('tidies greetings, Dumbledore and a missing brevity rule', () => {
    const t = tidyStudentPrompt(
      "Hi ChatGPT! I'm a student (Dumbledore) and I want help.\n1. a\n2. b",
      'en',
    )
    expect(t.startsWith("I'm a student")).toBe(true)
    expect(t).not.toMatch(/dumbledore/i)
    expect(t).toContain('No greetings or small talk')
    expect(tidyStudentPrompt('Olen lukiolainen ja tarvitsen apua.', 'fi')).toContain(
      'Ei tervehdyksiä',
    )
  })
})

describe('Brain.fixGaps', () => {
  const input = {
    assistant: 'ChatGPT',
    language: 'en',
    profile: 'First-year chemistry student',
    misses: [
      {
        concept: 'Carbocation stability',
        stem: 'Which carbocation is most stable?',
        chosen: 'Primary',
        correct: 'Tertiary',
        rationale: 'More alkyl groups donate electron density.',
      },
    ],
  }

  it('maps misses into the prompt and guarantees the closing quiz line', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        diagnoses: [
          {
            concept: 'Carbocation stability',
            misconception:
              'thinks fewer substituents means more stability somehow in all cases always',
          },
        ],
        prompt: goodPrompt,
        nextTopic: 'SN1 mechanism',
      },
    })
    const out = await h.brain.fixGaps(input)
    expect(h.userOf(h.groq)).toContain('chosen: Primary')
    expect(h.groq.requests[0]?.system).toContain(
      'Then quiz me with 2 new questions and wait for my answers.',
    )
    expect(out.prompt.endsWith('Then quiz me with 2 new questions and wait for my answers.')).toBe(
      true,
    )
    expect(out.diagnoses[0]?.misconception.split(/\s+/).length).toBeLessThanOrEqual(15)
  })

  it('needs no model call without misses', async () => {
    const h = brainHarness()
    expect(await h.brain.fixGaps({ ...input, misses: [] })).toEqual({
      diagnoses: [],
      prompt: '',
      nextTopic: '',
    })
    expect(h.groq.requests).toHaveLength(0)
  })
})

describe('Brain.improvePrompt and suggestPrompt', () => {
  it('keeps the draft in the prompt and prefixes the coach tip', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: { prompt: goodPrompt, coachTip: 'Added your level and a check question.' },
    })
    const out = await h.brain.improvePrompt({
      assistant: 'ChatGPT',
      language: 'auto',
      profile: 'First-year chemistry student',
      draft: 'why are tertiary carbocations more stable',
      context: 'Reading SN1 reaction – Wikipedia',
    })
    expect(h.userOf(h.groq)).toContain('<draft>\nwhy are tertiary carbocations more stable')
    expect(out.coachTip).toBe('What I improved: Added your level and a check question.')
  })

  it('falls back to the first candidate kind when basedOn is not offered', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: { prompt: goodPrompt, coachTip: 'Builds on your open question.', basedOn: 'deadline' },
    })
    const out = await h.brain.suggestPrompt({
      assistant: 'ChatGPT',
      language: 'en',
      profile: '',
      candidates: [{ kind: 'open_question', text: 'Why are tertiary carbocations more stable?' }],
      context: '',
    })
    expect(out.basedOn).toBe('open_question')
    expect(h.userOf(h.groq)).toContain('1. [open_question] Why are tertiary')
  })
})

describe('Brain.writeNudge and buildProfile', () => {
  it('writes nudges on the on-device model when it is available', async () => {
    const helper = { status: 'connected' } as unknown as HelperClient
    const h = brainHarness([R.apple, R.ovh], { helper })
    h.apple.queue({
      json: {
        title: 'Carbocations, quick check!',
        body: '3-minute check on carbocations? You missed two yesterday.',
      },
    })
    const out = await h.brain.writeNudge({
      kind: 'review_due',
      facts: 'carbocations: missed 2 of 3 yesterday',
      language: 'en',
    })
    expect(out).toEqual({
      title: 'Carbocations, quick check',
      body: '3-minute check on carbocations? You missed two yesterday.',
    })
    expect(h.apple.requests).toHaveLength(1)
  })

  it('builds a profile with at most two habits', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        summary: 'First-year chemistry student.',
        level: ' ',
        habitsToCoach: ['Give context', 'Ask to be quizzed', 'Extra'],
      },
    })
    const out = await h.brain.buildProfile({
      aboutMe: 'Chem student',
      subjects: 'Orgo',
      struggles: 'carbocations',
      habits: '2/10 with context',
    })
    expect(out).toEqual({
      summary: 'First-year chemistry student.',
      level: null,
      habitsToCoach: ['Give context', 'Ask to be quizzed'],
    })
    expect(h.userOf(h.groq)).toContain('<prompt_habits>\n2/10 with context')
  })
})

describe('tidyStudentPrompt lists', () => {
  it('puts inline numbered items on their own lines but leaves decimals alone', () => {
    const t = tidyStudentPrompt(
      "I'm a student; pH 2.5 confuses me. I need: 1. A definition 2. An example 3. A check. No greetings or small talk.",
      'en',
    )
    expect(t.split('\n')).toEqual([
      "I'm a student; pH 2.5 confuses me. I need:",
      '1. A definition',
      '2. An example',
      '3. A check.',
      'No greetings or small talk.',
    ])
  })
})
