import type { ExtractInput, ExtractOutput } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { FakeHelper } from '@engine/helper/fake'
import { FakeBrain } from '@engine/testing/fake-brain'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MaterialsFlow, PART_CHARS, splitParts } from './materials'

const PAGE = `${'Ramesses II ruled Egypt for 66 years and built Abu Simbel. '.repeat(40)}`

/** Files one note per episode on the subject the flow offered, so tests can count them. */
function noteBrain() {
  const inputs: ExtractInput[] = []
  const brain = new FakeBrain({
    extract: async (input): Promise<ExtractOutput> => {
      inputs.push(input)
      return {
        results: input.episodes.map((ep) => ({
          episodeId: ep.id,
          isLearning: false, // the flow treats chosen material as learning anyway
          confidence: 0.9,
          reason: 'Lecture notes',
          studentPrompts: [],
          items: [
            {
              subject: { matchId: null, newName: 'Somewhere else' },
              topicPath: ['New Kingdom', 'Ramesses II'],
              seen: ep.text.slice(0, 80),
              bigPicture: 'The New Kingdom pharaohs.',
              understanding: { status: 'unknown', evidence: '' },
              openQuestions: [],
              keyTerms: ['Abu Simbel'],
              assignment: null,
              notes: [
                {
                  text: `Ramesses II built Abu Simbel (${ep.title}).`,
                  keywords: ['Ramesses II'],
                  conceptId: null,
                  newConcept: { name: 'Ramesses II', parentId: null },
                },
              ],
            },
          ],
        })),
      }
    },
  })
  return { brain, inputs }
}

describe('splitParts', () => {
  it('cuts at paragraph breaks and caps the number of parts', () => {
    const text = Array.from({ length: 30 }, () => 'x'.repeat(1000)).join('\n\n')
    const parts = splitParts(text, PART_CHARS, 3)
    expect(parts).toHaveLength(3)
    expect(parts.every((p) => p.length <= PART_CHARS)).toBe(true)
  })

  it('drops empty text', () => {
    expect(splitParts('  \n\n \n')).toEqual([])
  })
})

describe('MaterialsFlow', () => {
  let clock: FakeClock
  let repos: Repos
  let helper: FakeHelper
  let subjectId: string

  beforeEach(async () => {
    clock = new FakeClock()
    repos = createMemoryRepos(clock)
    helper = new FakeHelper()
    await helper.start()
    subjectId = repos.subjects.create({ name: 'Egyptian History' }).id
  })

  it('files a PDF’s notes under the chosen subject, whatever the model matched', async () => {
    helper.respond('file.pdfText', () => ({
      text: `${PAGE}\n\n${PAGE}`,
      pages: 2,
      truncated: false,
    }))
    const { brain, inputs } = noteBrain()
    const changed = vi.fn()
    const flow = new MaterialsFlow({ repos, brain, clock, helper, changed })

    const [result] = await flow.add(subjectId, ['/Users/x/Lecture 3 – New Kingdom.pdf'])

    expect(result).toMatchObject({ name: 'Lecture 3 – New Kingdom.pdf', ok: true, error: null })
    expect(result?.notes).toBeGreaterThan(0)
    expect(inputs[0]?.subjects.map((s) => s.id)).toEqual([subjectId])
    expect(inputs[0]?.episodes[0]?.title).toContain('Lecture 3 – New Kingdom.pdf')
    const notes = repos.notes.list({ subjectId })
    expect(notes.some((n) => n.text.startsWith('Ramesses II built Abu Simbel'))).toBe(true)
    expect(repos.subjects.list({}).map((s) => s.name)).toEqual(['Egyptian History'])
    expect(changed).toHaveBeenCalledWith(subjectId)
  })

  it('reads documents through readDocument and reports a file with no text', async () => {
    const { brain } = noteBrain()
    const flow = new MaterialsFlow({
      repos,
      brain,
      clock,
      helper,
      changed: vi.fn(),
      readDocument: async (path) => (path.endsWith('empty.txt') ? '   ' : PAGE),
    })
    const results = await flow.add(subjectId, ['/x/notes.docx', '/x/empty.txt'])
    expect(results[0]).toMatchObject({ name: 'notes.docx', ok: true })
    expect(results[1]).toMatchObject({ name: 'empty.txt', ok: false })
    expect(results[1]?.error).toMatch(/No text found/)
  })

  it('reports an AI failure without filing anything', async () => {
    helper.respond('file.pdfText', () => ({ text: PAGE, pages: 1, truncated: false }))
    const brain = new FakeBrain({
      extract: async () => {
        throw new Error('brain task "extract" timed out')
      },
    })
    const flow = new MaterialsFlow({ repos, brain, clock, helper, changed: vi.fn() })
    const [result] = await flow.add(subjectId, ['/x/a.pdf'])
    expect(result).toMatchObject({ ok: false, notes: 0 })
    expect(result?.error).toMatch(/timed out/)
  })
})
