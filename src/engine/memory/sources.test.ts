import type { Note, SourceRef } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { createMemoryRepos } from '../testing/memory-repos'
import { sourceKey, sourceLabel, sourcesOfNotes, subtreeIds, topicSources } from './sources'

const MIN = 60_000
const page = (url: string | null, title: string | null, app = 'Google Chrome'): SourceRef => ({
  app,
  bundleId: null,
  url,
  title,
})
const WIKI = 'https://en.wikipedia.org/wiki/Tampere'
const VISIT = 'https://visittampere.fi/history'

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
  const note = (conceptId: string, text: string, source: SourceRef) => {
    clock.advance(MIN)
    return repos.notes.add({
      subjectId: history.id,
      conceptId,
      encounterId: null,
      kind: 'fact',
      text,
      source,
    }).note
  }
  return { clock, repos, history, finland, tampere, note }
}

describe('topic sources', () => {
  it('gathers one source per page, newest first, merging #fragments and skipping typed notes', () => {
    const { repos, finland, tampere, note } = setup()
    const a = note(
      tampere.id,
      'Tampere lies on the Tammerkoski rapids',
      page(WIKI, 'Tampere - Wikipedia - Google Chrome'),
    )
    const b = note(
      tampere.id,
      'Gustav III founded Tampere in 1779',
      page(`${WIKI}#History`, 'Tampere - Wikipedia - Google Chrome'),
    )
    const c = note(
      tampere.id,
      'Finlayson built a cotton mill in 1820',
      page(VISIT, 'History of Tampere'),
    )
    note(tampere.id, 'My own question about the mills', page(null, 'Dumbledore', 'Dumbledore'))

    const sources = topicSources(repos, tampere.id)
    expect(sources).toEqual([
      {
        title: 'History of Tampere',
        url: VISIT,
        app: 'Google Chrome',
        lastSeenAt: c.createdAt,
        noteCount: 1,
        noteIds: [c.id],
      },
      {
        title: 'Tampere - Wikipedia',
        url: WIKI,
        app: 'Google Chrome',
        lastSeenAt: b.createdAt,
        noteCount: 2,
        noteIds: [a.id, b.id],
      },
    ])

    // The parent topic gathers its own pages and its subtree's.
    const f = note(
      finland.id,
      'Finland became independent in 1917',
      page('https://en.wikipedia.org/wiki/Finland', 'Finland - Wikipedia'),
    )
    const parent = topicSources(repos, finland.id)
    expect(parent.map((s) => [s.title, s.noteCount])).toEqual([
      ['Finland - Wikipedia', 1],
      ['History of Tampere', 1],
      ['Tampere - Wikipedia', 2],
    ])
    expect(parent[0]?.noteIds).toEqual([f.id])
    // The child does not see its parent's pages.
    expect(topicSources(repos, tampere.id)).toHaveLength(2)
    expect(topicSources(repos, 'con_missing')).toEqual([])
  })

  it('keeps notes without a url apart per app and title', () => {
    const notes = [
      { source: page(null, 'Lecture 3.pdf', 'Preview') },
      { source: page(null, 'Lecture 3.pdf', 'Preview') },
      { source: page(null, 'Lecture 4.pdf', 'Preview') },
    ].map((n, i) => ({
      ...n,
      id: `not_${i}`,
      createdAt: `2026-10-24T09:0${i}:00.000Z`,
      updatedAt: `2026-10-24T09:0${i}:00.000Z`,
    })) as unknown as Note[]
    expect(sourcesOfNotes(notes).map((s) => [s.title, s.url, s.noteIds])).toEqual([
      ['Lecture 4.pdf', null, ['not_2']],
      ['Lecture 3.pdf', null, ['not_0', 'not_1']],
    ])
  })

  it('labels a source by its title without the browser tail, else its host, else its app', () => {
    expect(sourceLabel(page(WIKI, 'Tampere - Wikipedia - Google Chrome'))).toBe(
      'Tampere - Wikipedia',
    )
    expect(sourceLabel(page(WIKI, 'Tampere – Wikipedia — Google Chrome - Ilari (Work)'))).toBe(
      'Tampere – Wikipedia',
    )
    expect(sourceLabel(page(WIKI, 'Tampere | Safari'))).toBe('Tampere')
    expect(sourceLabel(page(WIKI, '  Tampere \n history  '))).toBe('Tampere history')
    expect(sourceLabel(page(WIKI, null))).toBe('en.wikipedia.org')
    expect(sourceLabel(page(WIKI, '   '))).toBe('en.wikipedia.org')
    expect(sourceLabel(page(null, null, 'Preview'))).toBe('Preview')
    expect(sourceLabel(page(null, 'x'.repeat(120)))).toHaveLength(80)
  })

  it('keys a source by its page url, else by app and label', () => {
    expect(sourceKey(page(`${WIKI}#History`, 'A'))).toBe(WIKI)
    expect(sourceKey(page(WIKI, 'B'))).toBe(WIKI)
    expect(sourceKey(page(null, 'Lecture 3.pdf - Google Chrome', 'Preview'))).toBe(
      'app:Preview|Lecture 3.pdf',
    )
  })

  it('finds a concept and all its descendants', () => {
    const c = (id: string, parentId: string | null) =>
      ({ id, parentId }) as Parameters<typeof subtreeIds>[1][number]
    const all = [c('d', 'b'), c('a', null), c('b', 'a'), c('c', 'a'), c('e', null)]
    expect([...subtreeIds('a', all)].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...subtreeIds('b', all)].sort()).toEqual(['b', 'd'])
    expect([...subtreeIds('e', all)]).toEqual(['e'])
  })
})
