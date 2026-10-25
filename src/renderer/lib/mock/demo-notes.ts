/**
 * Demo notes (docs/NOTES.md §3) for the mock API: a few facts and a highlight on the Organic
 * Chemistry concepts, a highlight on Geography (a subject with no roadmap), a prerequisite edge,
 * and two loose notes from casual reading.
 */
import type { ConceptEdge, Note, NoteKind } from '@shared/domain'
import type { GapNote } from '@shared/state'
import { DAY, HOUR, isoAgo } from './time'

const wiki = { app: 'Google Chrome', bundleId: 'com.google.Chrome', url: null }

function note(
  id: string,
  subjectId: string | null,
  conceptId: string | null,
  kind: NoteKind,
  text: string,
  title: string,
  ago: number,
  url: string | null = null,
): Note {
  return {
    id,
    subjectId,
    conceptId,
    encounterId: null,
    kind,
    text,
    keywords: [],
    source: { ...wiki, url, title },
    status: 'active',
    mergedInto: null,
    pinned: false,
    createdAt: isoAgo(ago),
    updatedAt: isoAgo(ago),
  }
}

export function demoNotes(): Note[] {
  const o = 'sub_orgo'
  return [
    note(
      'note_nu1',
      o,
      'con_nucleophiles',
      'definition',
      'A nucleophile donates an electron pair to an electrophile.',
      'Nucleophile – Wikipedia',
      2 * DAY,
      'https://en.wikipedia.org/wiki/Nucleophile',
    ),
    note(
      'note_lg1',
      o,
      'con_leaving',
      'fact',
      'Good leaving groups are weak bases, like I⁻, Br⁻ and TsO⁻.',
      'Leaving group – Wikipedia',
      30 * HOUR,
      'https://en.wikipedia.org/wiki/Leaving_group',
    ),
    note(
      'note_cc1',
      o,
      'con_carbocation',
      'fact',
      'Carbocation stability: tertiary > secondary > primary > methyl.',
      'ChatGPT',
      6 * HOUR,
    ),
    note(
      'note_cc2',
      o,
      'con_carbocation',
      'highlight',
      'Alkyl groups stabilise the positive charge by hyperconjugation.',
      'Carbocation – LibreTexts',
      5 * HOUR,
      'https://chem.libretexts.org/Carbocation',
    ),
    note(
      'note_sn1',
      o,
      'con_sn1',
      'fact',
      'SN1 goes through a carbocation, so its rate depends only on the substrate.',
      'ChatGPT',
      3 * HOUR,
    ),
    note(
      'note_un1',
      o,
      null,
      'fact',
      'Polar protic solvents stabilise ions in solution.',
      'Solvent effects – Khan Academy',
      2 * HOUR,
      'https://www.khanacademy.org/science/organic-chemistry',
    ),
    note(
      'note_geo1',
      'sub_geo',
      'con_plates',
      'highlight',
      'The lithosphere is broken into about fifteen major plates that move a few centimetres a year.',
      'Plate tectonics – Wikipedia',
      26 * HOUR,
      'https://en.wikipedia.org/wiki/Plate_tectonics',
    ),
    note(
      'note_loose1',
      null,
      null,
      'highlight',
      'James Finlayson founded a cotton mill in Tampere in 1820.',
      'Tampere – Wikipedia',
      40 * 60_000,
      'https://en.wikipedia.org/wiki/Tampere',
    ),
    note(
      'note_loose2',
      null,
      null,
      'fact',
      'Tampere got full city rights on 1 October 1779.',
      'Tampere – Wikipedia',
      38 * 60_000,
      'https://en.wikipedia.org/wiki/Tampere',
    ),
  ]
}

/** Your gaps on Carbocation stability: what an exam showed, and what was asked in the chat. */
export function demoGapNotes(): GapNote[] {
  return [
    {
      id: 'note_cc_q',
      conceptId: 'con_carbocation',
      kind: 'question',
      text: 'Why does hyperconjugation stabilise the cation more than induction?',
      createdAt: isoAgo(3 * HOUR),
      source: 'Asked Dumbledore',
    },
    {
      id: 'note_cc_mis',
      conceptId: 'con_carbocation',
      kind: 'misconception',
      text: 'Thought primary carbocations are the most stable',
      createdAt: isoAgo(2 * DAY),
      source: 'Exam: Organic Chemistry · weak spots',
    },
  ]
}

export function demoEdges(): ConceptEdge[] {
  return [
    {
      fromId: 'con_carbocation',
      toId: 'con_sn1',
      why: 'SN1 runs through a carbocation intermediate.',
      source: 'llm',
      createdAt: isoAgo(DAY),
    },
  ]
}
