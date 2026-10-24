import type { QuestionDraft, VerifyResult } from '@engine/brain-contract'
import { FakeBrain } from '@engine/testing/fake-brain'
import { describe, expect, it, vi } from 'vitest'
import { verifyWithRetries } from './verify'

const draft = (concept: string, correctIndex = 0, tag = ''): QuestionDraft => ({
  concept,
  stem: `Which is true about ${concept}?${tag}`,
  options: ['right', 'wrong one', 'wrong two', 'wrong three'].map((o, i) =>
    i === correctIndex ? 'right' : `${o} ${i}`,
  ),
  correctIndex,
  rationales: ['r0', 'r1', 'r2', 'r3'],
  difficulty: 2,
})

const silent = () => {}

describe('verifyWithRetries', () => {
  it('keeps questions the blind verifier agrees with', async () => {
    const brain = new FakeBrain()
    const regenerate = vi.fn(async () => [])
    const drafts = [draft('SN1'), draft('E1', 2)]
    const out = await verifyWithRetries({ brain, drafts, regenerate, log: silent })
    expect(out).toEqual({ questions: drafts, dropped: 0, regenerated: 0, verified: true })
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('regenerates a mismatch and keeps the new version in its slot', async () => {
    let round = 0
    const brain = new FakeBrain({
      verifyQuestions: async (qs): Promise<VerifyResult[]> => {
        round++
        return qs.map((q, index) => ({
          index,
          chosen: round === 1 && index === 1 ? (q.correctIndex + 1) % 4 : q.correctIndex,
          confidence: 0.9,
        }))
      },
    })
    const replacement = draft('E1', 3, ' (v2)')
    const regenerate = vi.fn(async () => [replacement])
    const drafts = [draft('SN1'), draft('E1', 2), draft('SN2', 1)]
    const out = await verifyWithRetries({ brain, drafts, regenerate, log: silent })
    expect(regenerate).toHaveBeenCalledWith([drafts[1]])
    expect(out.questions.map((q) => q.stem)).toEqual([
      drafts[0]?.stem,
      replacement.stem,
      drafts[2]?.stem,
    ])
    expect(out).toMatchObject({ dropped: 0, regenerated: 1, verified: true })
  })

  it('drops a question that still mismatches after two regenerations', async () => {
    const brain = new FakeBrain({
      verifyQuestions: async (qs) =>
        qs.map((q, index) => ({
          index,
          chosen: q.concept === 'E1' ? (q.correctIndex + 1) % 4 : q.correctIndex,
          confidence: 0.6,
        })),
    })
    let n = 0
    const regenerate = vi.fn(async () => [draft('E1', 0, ` v${++n}`)])
    const out = await verifyWithRetries({
      brain,
      drafts: [draft('SN1'), draft('E1')],
      regenerate,
      log: silent,
    })
    expect(regenerate).toHaveBeenCalledTimes(2)
    expect(brain.calls.filter((c) => c.method === 'verifyQuestions')).toHaveLength(3)
    expect(out.questions.map((q) => q.concept)).toEqual(['SN1'])
    expect(out).toMatchObject({ dropped: 1, regenerated: 2 })
  })

  it('treats a missing verdict as a mismatch', async () => {
    const brain = new FakeBrain({
      verifyQuestions: async () => [{ index: 0, chosen: 0, confidence: 1 }],
    })
    const out = await verifyWithRetries({
      brain,
      drafts: [draft('SN1'), draft('E1')],
      regenerate: async () => [],
      log: silent,
    })
    expect(out.questions.map((q) => q.concept)).toEqual(['SN1'])
    expect(out.dropped).toBe(1)
  })

  it('keeps questions unverified when the verifier is down, drops on failed regeneration', async () => {
    const down = new FakeBrain({
      verifyQuestions: async () => {
        throw new Error('offline')
      },
    })
    const drafts = [draft('SN1'), draft('E1')]
    const out = await verifyWithRetries({
      brain: down,
      drafts,
      regenerate: async () => [],
      log: silent,
    })
    expect(out).toMatchObject({ questions: drafts, verified: false, dropped: 0 })

    const picky = new FakeBrain({
      verifyQuestions: async (qs) => qs.map((_, index) => ({ index, chosen: 3, confidence: 1 })),
    })
    const failing = await verifyWithRetries({
      brain: picky,
      drafts,
      regenerate: async () => {
        throw new Error('rate limited')
      },
      log: silent,
    })
    expect(failing).toMatchObject({ questions: [], dropped: 2, regenerated: 0 })
  })
})
