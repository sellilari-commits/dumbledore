import { describe, expect, it } from 'vitest'
import { materializeRoadmap } from './materialize'
import {
  dedupePhrases,
  evidenceText,
  seenText,
  stripContextLabels,
  topicPathOf,
} from './memory-text'
import { applyMemoryUpdates } from './memory-updates'
import { createHarness, ORGO_PLAN, seedSubject } from './test-helpers'

describe('memory-update text', () => {
  it('strips echoed context labels from evidence (real-run string)', () => {
    expect(stripContextLabels('Struggling with Missed 2 times recently Leaving groups')).toBe(
      'Leaving groups',
    )
    expect(
      evidenceText(
        ['Struggling with Missed 2 times recently Leaving groups'],
        'Leaving groups',
        'struggling',
      ),
    ).toBe('Had trouble with leaving groups in the chat.')
    expect(
      evidenceText(
        ['Struggling with: Leaving groups · mixed up iodide and fluoride as leaving groups'],
        'Leaving groups',
        'unclear',
      ),
    ).toBe('Mixed up iodide and fluoride as leaving groups.')
  })

  it('keeps a real evidence sentence and drops repeated phrases', () => {
    expect(
      evidenceText(
        ['Mixed up iodide and fluoride.', 'Mixed up iodide and fluoride', 'struggled 1× recently'],
        'Leaving groups',
        'struggling',
      ),
    ).toBe('Mixed up iodide and fluoride.')
    expect(dedupePhrases('Asked about SN2. Asked about SN2. Then SN1.')).toBe(
      'Asked about SN2. Then SN1.',
    )
    expect(evidenceText([], 'Leaving groups', null)).toBe('')
  })

  it('writes Seen as what the student asked, not a log line (real-run string)', () => {
    const seen = seenText(
      [],
      'Leaving groups',
      'Nucleophiles, Electrophiles, and Leaving Groups',
      'Claude',
    )
    expect(seen).toBe('Asked Claude to explain Nucleophiles, Electrophiles, and Leaving Groups.')
    expect(seen).not.toMatch(/Studied|step:/)
    expect(seenText([], 'SN2 mechanism', 'Backside attack', 'ChatGPT')).toBe(
      'Asked ChatGPT to explain SN2 mechanism (Backside attack).',
    )
    expect(
      seenText(
        ['Why is iodide a better leaving group than fluoride?'],
        'Leaving groups',
        'x',
        'ChatGPT',
      ),
    ).toBe('Why is iodide a better leaving group than fluoride?')
  })

  it('builds the topic path without repeats', () => {
    expect(
      topicPathOf(['Organic Chemistry', 'SN1 vs SN2', 'sn1 vs sn2', 'Leaving groups']),
    ).toEqual(['Organic Chemistry', 'SN1 vs SN2', 'Leaving groups'])
  })

  it("stores clean encounters from the brain's memory updates", () => {
    const h = createHarness()
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const roadmap = materializeRoadmap({
      id: 'rdm_1',
      subjectId: subject.id,
      plan: structuredClone(ORGO_PLAN),
      carry: [],
      noHistory: false,
      nowIso: h.clock.nowIso(),
    })
    applyMemoryUpdates(
      {
        repos: h.repos,
        mastery: h.mastery,
        subject,
        roadmap,
        stepTitle: 'Nucleophiles, Electrophiles, and Leaving Groups',
        assistant: 'Claude',
        nowIso: h.clock.nowIso(),
      },
      [
        {
          type: 'understanding',
          concept: 'Leaving groups',
          value: 'struggling',
          evidence: 'Struggling with Missed 2 times recently Leaving groups',
        },
      ],
    )
    const [encounter] = h.repos.encounters.list({ subjectId: subject.id })
    expect(encounter).toMatchObject({
      seen: 'Asked Claude to explain Nucleophiles, Electrophiles, and Leaving Groups.',
      bigPicture: 'Organic Chemistry › SN1 vs SN2 › Leaving groups',
      topicPath: ['Organic Chemistry', 'Leaving groups'],
      understanding: 'struggling',
      evidence: 'Had trouble with leaving groups in the chat.',
    })
  })
})
