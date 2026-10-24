/**
 * Demo notes (docs/NOTES.md §3) for the mock API: a few facts and a highlight on the Organic
 * Chemistry concepts, a highlight on Geography (a subject with no roadmap), a prerequisite edge,
 * and two loose notes from casual reading.
 */
import type { ConceptEdge, Note, NoteKind } from '@shared/domain'
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
): Note {
  return {
    id,
    subjectId,
    conceptId,
    encounterId: null,
    kind,
    text,
    keywords: [],
    source: { ...wiki, title },
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
    ),
    note(
      'note_lg1',
      o,
      'con_leaving',
      'fact',
      'Good leaving groups are weak bases, like I⁻, Br⁻ and TsO⁻.',
      'Leaving group – Wikipedia',
      30 * HOUR,
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
    ),
    note(
      'note_geo1',
      'sub_geo',
      'con_plates',
      'highlight',
      'The lithosphere is broken into about fifteen major plates that move a few centimetres a year.',
      'Plate tectonics – Wikipedia',
      26 * HOUR,
    ),
    note(
      'note_loose1',
      null,
      null,
      'highlight',
      'James Finlayson founded a cotton mill in Tampere in 1820.',
      'Tampere – Wikipedia',
      40 * 60_000,
    ),
    note(
      'note_loose2',
      null,
      null,
      'fact',
      'Tampere got full city rights on 1 October 1779.',
      'Tampere – Wikipedia',
      38 * 60_000,
    ),
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
