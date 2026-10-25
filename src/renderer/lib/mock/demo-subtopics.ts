/**
 * `?subtopics=1`: the demo with a topic tree under "Carbocation stability" (Hyperconjugation
 * moves under it, plus Carbocation rearrangements → Hydride shifts), each with a highlight, and
 * an outline passage on the topic, so the panel's topic detail shows subtopics, your notes and
 * extracted items. Opt-in, so the default demo and its screenshots stay as
 * they are.
 */
import type { Concept, Note } from '@shared/domain'
import { HOUR, isoAgo } from './time'

export function addDemoSubtopics(db: { concepts: Concept[]; notes: Note[] }): void {
  const top = db.concepts.find((c) => c.id === 'con_carbocation')
  if (!top) return
  const hyper = db.concepts.find((c) => c.id === 'con_hyperconj')
  if (hyper) hyper.parentId = top.id
  const child = (id: string, name: string, parentId: string, ago: number): Concept => ({
    ...top,
    id,
    name,
    parentId,
    summary: '',
    mastery: 0,
    status: 'new',
    struggleCount: 0,
    box: 0,
    lastSeenAt: isoAgo(ago),
    nextReviewAt: null,
  })
  db.concepts.push(
    child('con_rearr', 'Carbocation rearrangements', top.id, 1 * HOUR),
    child('con_hydride', 'Hydride shifts', 'con_rearr', 1 * HOUR),
  )
  const flag = (id: string, conceptId: string, text: string, title: string, ago: number): Note => ({
    id,
    subjectId: top.subjectId,
    conceptId,
    encounterId: 'enc_demo',
    kind: 'highlight',
    text,
    keywords: [],
    source: { app: 'Google Chrome', bundleId: 'com.google.Chrome', url: null, title },
    status: 'active',
    mergedInto: null,
    pinned: false,
    createdAt: isoAgo(ago),
    updatedAt: isoAgo(ago),
  })
  db.notes.push(
    {
      ...flag(
        'note_ol1',
        top.id,
        'A carbocation is stabilised by neighbouring alkyl groups, which push electron density toward the positive carbon.',
        'Carbocation - Wikipedia - Google Chrome - Ilari (stuhi.org)',
        20 * 60_000,
      ),
      encounterId: null,
      keywords: ['explains why 3° beats 1°'],
    },
    flag(
      'note_hy1',
      'con_hyperconj',
      'Each C–H bond next to the empty p orbital donates a little electron density.',
      'Hyperconjugation - Wikipedia - Google Chrome - Ilari (stuhi.org)',
      4 * HOUR,
    ),
    flag(
      'note_hs1',
      'con_hydride',
      'A 1,2-hydride shift turns a secondary carbocation into a more stable tertiary one.',
      'Carbocation rearrangements - Chemistry LibreTexts - Google Chrome - Ilari (stuhi.org)',
      2 * HOUR,
    ),
  )
}
