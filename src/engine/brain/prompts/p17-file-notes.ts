/**
 * P17 Note filing (tier `triage`): notes and highlights saved without a topic (casual reading
 * that matched no subject, or an outline highlight in a subject but not in its tree) go to the
 * best existing topic of the best subject, judged from the note text and the page it came from.
 * One call per batch of notes; nothing is created, reworded or deleted. When nothing fits, the
 * note stays where it is. Short refs (n1, s1, c1) save tokens; finalize maps them back to ids.
 */
import {
  type FileNotesInput,
  type FileNotesModelOutput,
  FileNotesModelOutput as FileNotesModelOutputSchema,
  type FileNotesOutput,
} from '@engine/brain-contract'
import { clip } from '../llm/text'
import { type PromptSpec, tag } from './shared'

interface Refs {
  notes: Map<string, string>
  subjects: Map<string, string>
  concepts: Map<string, string>
}

/** Deterministic refs from the input order (build and finalize compute the same ones). */
function refsOf(input: FileNotesInput): {
  toRef: (kind: 'n' | 's' | 'c', id: string) => string
  back: Refs
} {
  const forward = new Map<string, string>()
  const back: Refs = { notes: new Map(), subjects: new Map(), concepts: new Map() }
  let c = 0
  input.subjects.forEach((s, i) => {
    forward.set(`s:${s.id}`, `s${i + 1}`)
    back.subjects.set(`s${i + 1}`, s.id)
    for (const k of s.concepts) {
      c++
      forward.set(`c:${k.id}`, `c${c}`)
      back.concepts.set(`c${c}`, k.id)
    }
  })
  input.notes.forEach((n, i) => {
    forward.set(`n:${n.id}`, `n${i + 1}`)
    back.notes.set(`n${i + 1}`, n.id)
  })
  return { toRef: (kind, id) => forward.get(`${kind}:${id}`) ?? '', back }
}

export const fileNotesPrompt: PromptSpec<FileNotesInput, FileNotesModelOutput, FileNotesOutput> = {
  id: 'P17',
  task: 'fileNotes',
  version: 1,
  tier: 'triage',
  temperature: 0,
  maxOutputTokens: 1200,
  reasoningEffort: 'low',
  schemaName: 'file_notes',
  schema: FileNotesModelOutputSchema,
  onDeviceOk: false,
  cacheable: true,
  language: () => 'en',
  build: (input) => {
    const { toRef } = refsOf(input)
    const subjects = input.subjects
      .map((s) => {
        const head = `${toRef('s', s.id)} ${s.name}${s.goal ? ` (goal: ${clip(s.goal, 80)})` : ''}`
        const tree = s.concepts.map(
          (k) =>
            `  ${toRef('c', k.id)} ${k.name}${k.parentId ? ` < ${toRef('c', k.parentId)}` : ''}`,
        )
        return [head, ...tree].join('\n')
      })
      .join('\n')
    const notes = input.notes
      .map(
        (n) =>
          `${toRef('n', n.id)}${n.subjectId ? ` [in ${toRef('s', n.subjectId)}]` : ''} "${clip(n.text, 220)}" (from: ${clip(n.source, 80)})`,
      )
      .join('\n')
    return {
      system: `You file a student's study notes. Each note was saved without a topic. Put each one in the best existing topic of the best subject, judging by what the note says and the page it came from.
- Subjects are listed as "s1 Name", each with its topics as "c3 Name < c1" (c1 is the parent topic).
- Pick the most specific topic the note is really about. A note marked "[in s2]" may only go to a topic of s2.
- When the note clearly belongs to a subject but none of its topics fits, give the subject with concept null (not for notes marked "[in …]").
- When no subject fits, give subject null and concept null: the note stays loose. Don't force a fit; a loose note is better than a wrong one.
- Never invent refs. One placement per note, every note once.`,
      user: [tag('subjects', subjects || '(none)'), tag('notes', notes)].join('\n'),
    }
  },
  finalize: (out, input) => {
    const { back } = refsOf(input)
    const seen = new Set<string>()
    const placements: FileNotesOutput['placements'] = []
    for (const p of out.placements) {
      const noteId = back.notes.get(p.note.trim())
      if (!noteId || seen.has(noteId)) continue
      seen.add(noteId)
      placements.push({
        noteId,
        subjectId: (p.subject && back.subjects.get(p.subject.trim())) || null,
        conceptId: (p.concept && back.concepts.get(p.concept.trim())) || null,
      })
    }
    return { placements }
  },
}
