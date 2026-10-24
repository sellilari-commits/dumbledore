import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '@engine/clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Episode, SourceRef } from '@shared/domain'
import { afterAll, describe, expect, it } from 'vitest'
import { buildTopicText, topicFileName, writeTopicText } from './topic-text'

const MIN = 60_000
const WIKI = 'https://en.wikipedia.org/wiki/Tampere'
const page = (url: string | null, title: string | null, app = 'Google Chrome'): SourceRef => ({
  app,
  bundleId: null,
  url,
  title,
})

function setup() {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const history = repos.subjects.create({ name: 'History' })
  const finland = repos.concepts.upsert({ subjectId: history.id, name: 'Finland' })
  const tampere = repos.concepts.upsert({
    subjectId: history.id,
    name: 'Tampere',
    parentName: 'Finland',
  })
  repos.concepts.update(finland.id, { summary: 'A Nordic country; Tampere is its mill city.' })
  const other = repos.concepts.upsert({ subjectId: history.id, name: 'Sweden' })

  const episode = (id: string, source: SourceRef, text: string): Episode => {
    const at = new Date(clock.now()).toISOString()
    const ep: Episode = {
      id,
      bundleId: 'com.google.Chrome',
      app: source.app,
      title: source.title,
      url: source.url,
      kind: 'reading',
      aiProvider: null,
      startedAt: at,
      endedAt: at,
      dwellSeconds: 180,
      text,
      source: 'ax',
      signals: {
        readingWpm: null,
        baselineWpm: null,
        scrollBacks: 0,
        revisitsToday: 0,
        searches: [],
        aiQuestions: [],
        highlights: [],
      },
      extracted: true,
    }
    repos.episodes.save(ep)
    return ep
  }
  const encounter = (
    conceptId: string,
    episodeId: string | null,
    source: SourceRef,
    seen: string,
  ) => {
    clock.advance(MIN)
    return repos.encounters.add({
      subjectId: history.id,
      conceptId,
      episodeId,
      seen,
      bigPicture: 'How Tampere grew around its rapids',
      topicPath: ['Finland', 'Tampere'],
      understanding: 'understood',
      evidence: 'read the whole section',
      openQuestions: ['Why there?'],
      keyTerms: ['Tammerkoski'],
      source,
      dwellSeconds: 180,
    })
  }
  const note = (conceptId: string, encounterId: string | null, text: string, source: SourceRef) => {
    clock.advance(MIN)
    return repos.notes.add({
      subjectId: history.id,
      conceptId,
      encounterId,
      kind: 'highlight',
      text,
      source,
    }).note
  }
  return { clock, repos, finland, tampere, other, episode, encounter, note }
}

describe('topic text', () => {
  it('gathers the topic and its subtopics by source, oldest first, with screen text and notes', () => {
    const { clock, repos, finland, tampere, other, episode, encounter, note } = setup()
    const wiki = page(WIKI, 'Tampere - Wikipedia - Google Chrome - Ilari')
    const ep = episode('ep_1', wiki, 'Tampere is a city in Pirkanmaa.\nIt lies between two lakes.')
    const first = encounter(tampere.id, ep.id, wiki, 'Tampere lies on the Tammerkoski rapids')
    note(tampere.id, first.id, 'Tampere lies between two lakes', wiki)
    const visit = page('https://visittampere.fi/history', 'History of Tampere')
    encounter(finland.id, 'ep_gone', visit, 'Finlayson built a cotton mill in 1820')
    note(
      finland.id,
      null,
      'Gustav III founded Tampere in 1779',
      page(`${WIKI}#History`, 'Tampere - Wikipedia'),
    )
    note(finland.id, null, 'Ask about the mills', page(null, 'Typed in chat', 'Dumbledore'))
    encounter(other.id, null, page('https://sv.wikipedia.org', 'Sverige'), 'Not about Finland')

    const { name, text } = buildTopicText(repos, finland.id, new Date(clock.now()).toISOString())
    expect(name).toBe('Finland')
    expect(text).toMatch(/^Finland — all extracted text\n/)
    expect(text).toContain('A Nordic country; Tampere is its mill city.')
    expect(text).toContain('Includes: Tampere')
    // Two sources, oldest first; a #fragment is the same page.
    expect(text.indexOf('Source 1 of 2: Tampere - Wikipedia')).toBeGreaterThan(0)
    expect(text.indexOf('Source 2 of 2: History of Tampere')).toBeGreaterThan(
      text.indexOf('Source 1 of 2'),
    )
    expect(text).not.toContain('Google Chrome - Ilari')
    expect(text).toContain('    It lies between two lakes.')
    expect(text).toContain('Seen: Tampere lies on the Tammerkoski rapids')
    expect(text).toContain('• Tampere lies between two lakes')
    expect(text).toContain('• Gustav III founded Tampere in 1779')
    // The second visit's screen text is gone, and the file says so.
    expect(text).toContain('Screen text: no longer kept.')
    expect(text).toMatch(/For one visit it is gone/)
    expect(text).toContain('Your own notes')
    expect(text).toContain('• Ask about the mills')
    expect(text).not.toContain('Not about Finland')
  })

  it('says when nothing was captured, and refuses an unknown topic', () => {
    const { repos, other } = setup()
    expect(buildTopicText(repos, other.id, '2026-10-25T12:00:00.000Z').text).toContain(
      'Nothing was captured about this topic yet.',
    )
    expect(() => buildTopicText(repos, 'cpt_missing', '2026-10-25T12:00:00.000Z')).toThrow(
      /no longer exists/,
    )
  })

  describe('file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-topic-text-'))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('names the file after the topic and writes it owner-only, replacing the last one', () => {
      expect(topicFileName('Eigenvalues & eigenvectors', 'cpt_1')).toBe(
        'eigenvalues-eigenvectors-cpt_1.txt',
      )
      expect(topicFileName('???', 'cpt_2')).toBe('topic-cpt_2.txt')
      const path = writeTopicText(dir, 'cpt_1', { name: 'Tampere', text: 'one\n' })
      expect(path).toBe(join(dir, 'topics', 'tampere-cpt_1.txt'))
      writeTopicText(dir, 'cpt_1', { name: 'Tampere', text: 'two\n' })
      expect(readFileSync(path, 'utf8')).toBe('two\n')
      expect(statSync(path).mode & 0o777).toBe(0o600)
    })
  })
})
