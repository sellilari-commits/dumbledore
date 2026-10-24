/** Episode factory for perception tests. */
import type { Episode } from '@shared/domain'

let counter = 0

export const STUDY_TEXT = [
  'The SN1 reaction is a nucleophilic substitution in which the rate-determining step is unimolecular.',
  'The leaving group departs first and forms a carbocation intermediate; the nucleophile attacks afterwards.',
  'Tertiary substrates react fastest because hyperconjugation stabilises the carbocation.',
  'Rate = k[R–X], so the reaction is first order overall and independent of the nucleophile concentration.',
].join('\n')

export function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  counter++
  return {
    id: `epi_test${counter}`,
    bundleId: 'com.google.Chrome',
    app: 'Google Chrome',
    title: 'SN1 reaction - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/SN1_reaction',
    kind: 'reading',
    aiProvider: null,
    startedAt: '2026-10-24T09:00:00.000Z',
    endedAt: '2026-10-24T09:03:00.000Z',
    dwellSeconds: 180,
    text: STUDY_TEXT,
    source: 'ax',
    signals: {
      readingWpm: 120,
      baselineWpm: 200,
      scrollBacks: 2,
      revisitsToday: 0,
      searches: [],
      aiQuestions: [],
      highlights: [],
    },
    extracted: false,
    ...overrides,
  }
}

/**
 * Episode options for suites that test the reading model on whole visits (dwell, scroll-backs,
 * dedupe across checkpoints): no early first checkpoint, so one visit stays one segment until the
 * rolling 3-minute checkpoint. The early checkpoint has its own tests with the real defaults.
 */
export const ONE_SEGMENT_PER_VISIT = { firstCheckpointMs: Number.POSITIVE_INFINITY } as const
