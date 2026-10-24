import type { Note } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import {
  cleanTitle,
  groupByPage,
  recentTimeline,
  shortAgo,
  sourceLink,
  topicSources,
} from './memory-model'

const at = (minAgo: number, now = Date.parse('2026-10-25T12:00:00Z')) =>
  new Date(now - minAgo * 60_000).toISOString()

function note(id: string, url: string | null, title: string | null, minAgo: number): Note {
  return {
    id,
    subjectId: 'sub_1',
    conceptId: 'con_1',
    encounterId: null,
    kind: 'fact',
    text: `text ${id}`,
    keywords: [],
    source: { app: url ? 'Google Chrome' : 'Preview', bundleId: null, url, title },
    status: 'active',
    mergedInto: null,
    pinned: false,
    createdAt: at(minAgo),
    updatedAt: at(minAgo),
  }
}

describe('memory model', () => {
  it('cleans browser chrome out of window titles', () => {
    expect(
      cleanTitle('Neural network - Wikipedia - Google Chrome - Ilari (stuhi.org)', 'Google Chrome'),
    ).toBe('Neural network - Wikipedia')
  })

  it('links only http(s) pages; apps and files stay plain', () => {
    expect(sourceLink(note('a', 'https://x.org/p', 'P', 1)).href).toBe('https://x.org/p')
    expect(sourceLink(note('b', 'file:///Users/a/b.pdf', 'b.pdf', 1)).href).toBeNull()
    expect(sourceLink(note('c', null, 'paper.pdf', 1))).toEqual({
      label: 'paper.pdf',
      href: null,
      app: 'Preview',
    })
  })

  it('groups notes by page, newest page first', () => {
    const groups = groupByPage([
      note('1', 'https://a', 'A', 30),
      note('2', 'https://b', 'B', 10),
      note('3', 'https://a', 'A', 5),
    ])
    expect(groups.map((g) => [g.source.label, g.notes.map((n) => n.id)])).toEqual([
      ['A', ['3', '1']],
      ['B', ['2']],
    ])
  })

  it('a topic with two sources keeps each source with its own notes', () => {
    const notes = [note('1', 'https://a', 'A', 30), note('2', 'https://b', 'B', 10)]
    const derived = topicSources(notes)
    expect(derived).toHaveLength(2)
    const fromTree = topicSources(notes, [
      { title: 'Page A', url: 'https://a', app: 'Google Chrome', lastSeenAt: at(1) },
      { title: 'Page B', url: 'https://b', app: 'Google Chrome', lastSeenAt: at(2) },
    ])
    expect(fromTree.map((g) => [g.source.label, g.notes.map((n) => n.id)])).toEqual([
      ['Page A', ['1']],
      ['Page B', ['2']],
    ])
  })

  it('builds the Recent timeline by day and page with where the notes went', () => {
    const now = new Date('2026-10-25T12:00:00Z')
    const days = recentTimeline(
      [
        note('1', 'https://a', 'A', 20),
        note('2', 'https://a', 'A', 10),
        note('3', 'https://b', 'B', 60 * 30),
      ],
      (n) => (n.id === '3' ? null : 'ML › Neurons'),
      now,
    )
    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday'])
    expect(days[0]?.entries[0]).toMatchObject({ places: ['ML › Neurons'] })
    expect(days[0]?.entries[0]?.notes).toHaveLength(2)
    expect(days[1]?.entries[0]?.places).toEqual(['Loose notes'])
  })

  it('formats short relative times', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')
    expect(shortAgo(at(0), now)).toBe('now')
    expect(shortAgo(at(5), now)).toBe('5 min')
    expect(shortAgo(at(120), now)).toBe('2 h')
    expect(shortAgo(at(60 * 48), now)).toBe('2 d')
  })
})
