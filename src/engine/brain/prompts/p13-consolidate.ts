/**
 * P13 Consolidation (tier `reason`): the LLM restructuring pass over one subject's notes
 * (docs/NOTES.md §5) — Generative-Agents-style reflection that writes RAPTOR-like concept
 * summaries from the notes, merges duplicates, builds a TnT-LLM-like topic level (3–9 topics) and
 * GraphRAG-like prerequisite edges. Concepts and notes travel as short refs (c1…, n1…) to keep
 * tokens down; finalize maps them back. Nothing is trusted here: consolidate/apply.ts validates
 * every proposal (ids, cycles, pinned notes, evidence) before it touches memory.
 */
import type { ConsolidateInput, ConsolidateOutput } from '@engine/brain-contract'
import { z } from 'zod'
import { looksFinnish } from '../llm/text'
import { type PromptSpec, tag } from './shared'

export const LlmConsolidate = z.object({
  summaries: z.array(z.object({ concept: z.string(), summary: z.string() })),
  mergeConcepts: z.array(z.object({ from: z.string(), into: z.string() })),
  mergeNotes: z.array(
    z.object({ from: z.string(), into: z.string(), text: z.string().nullable() }),
  ),
  topics: z.array(
    z.object({ concept: z.string().nullable(), name: z.string(), children: z.array(z.string()) }),
  ),
  placeNotes: z.array(z.object({ note: z.string(), concept: z.string() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), why: z.string() })),
  openQuestions: z.array(z.object({ concept: z.string().nullable(), question: z.string() })),
})
export type LlmConsolidate = z.infer<typeof LlmConsolidate>

const SYSTEM = `You keep one subject of a student's study notes tidy, like a careful tutor organising a notebook. You get the subject's concept tree, its notes and its prerequisite edges. Concepts are "c3 Name < c1" (c3 sits under c1; "< -" = top level) with status and mastery; notes are "n7 c3 fact: text" ("-" = not placed yet), and [pinned] marks a note the student wrote or edited.

Return:
- summaries: for every concept that has notes, 1–3 plain sentences written only from its notes (and its children's), in the language of the notes. Skip concepts without notes.
- mergeConcepts: two concepts that are the same thing, from → into (into = the clearer name).
- mergeNotes: two notes that say the same thing, from → into, with text = a better combined wording or null. Never merge a pinned note.
- topics: the subject's top level — 3 to 9 broad topics (fewer only when the subject is tiny). Each topic is an existing concept (concept = its ref) or a new topic (concept null, a short name of 1–4 words), and children = the refs of the concepts that belong directly under it. Every concept that has notes ends up under a topic. A topic needs at least one child with notes. Never put a concept under itself or under its own child.
- placeNotes: each unplaced or misplaced note → the concept it belongs to. Never move a pinned note.
- edges: A → B only when B cannot be understood without A, with why (≤ 12 words). Only between concepts listed here, never in a cycle.
- openQuestions: up to 5 questions the student probably still has, from the notes, each on its concept ref or null.

Never invent facts, concepts or topics the notes do not support. Use only refs that appear in the input. Return JSON only.`

/** Short refs both ways: concepts c1…, notes n1… in listing order. */
export function consolidateRefs(input: ConsolidateInput): {
  toId: Map<string, string>
  conceptRef: Map<string, string>
  noteRef: Map<string, string>
} {
  const toId = new Map<string, string>()
  const conceptRef = new Map<string, string>()
  const noteRef = new Map<string, string>()
  input.concepts.forEach((c, i) => {
    conceptRef.set(c.id, `c${i + 1}`)
    toId.set(`c${i + 1}`, c.id)
  })
  input.notes.forEach((n, i) => {
    noteRef.set(n.id, `n${i + 1}`)
    toId.set(`n${i + 1}`, n.id)
  })
  return { toId, conceptRef, noteRef }
}

export function buildConsolidateUser(input: ConsolidateInput): string {
  const { conceptRef, noteRef } = consolidateRefs(input)
  const ref = (id: string | null) => (id ? (conceptRef.get(id) ?? '-') : '-')
  const concepts = input.concepts.map((c) => {
    const head = `${ref(c.id)} ${c.name} [${c.status} ${c.mastery.toFixed(2)}] < ${ref(c.parentId)}`
    return c.summary.trim() ? `${head}\n   summary: ${c.summary.replace(/\s+/g, ' ').trim()}` : head
  })
  const notes = input.notes.map(
    (n) =>
      `${noteRef.get(n.id)} ${ref(n.conceptId)} ${n.kind}${n.pinned ? ' [pinned]' : ''}: ${n.text.replace(/\s+/g, ' ').trim()}`,
  )
  const edges = input.edges.map((e) => `${ref(e.fromId)} → ${ref(e.toId)}`)
  return [
    tag(
      'subject',
      `${input.subject.name}${input.subject.goal ? ` · goal: ${input.subject.goal}` : ''}`,
    ),
    tag('concepts', concepts.join('\n') || '(none)'),
    tag('notes', notes.join('\n') || '(none)'),
    tag('edges', edges.join('\n') || '(none)'),
  ].join('\n')
}

export function finalizeConsolidate(
  out: LlmConsolidate,
  input: ConsolidateInput,
): ConsolidateOutput {
  const { toId } = consolidateRefs(input)
  // Unknown refs pass through unchanged; apply.ts drops what does not exist.
  const id = (ref: string) => toId.get(ref.trim()) ?? ref.trim()
  const opt = (ref: string | null) => (ref?.trim() ? id(ref) : null)
  return {
    summaries: out.summaries
      .filter((s) => s.summary.trim())
      .map((s) => ({ conceptId: id(s.concept), summary: s.summary.trim() })),
    mergeConcepts: out.mergeConcepts.map((m) => ({ fromId: id(m.from), intoId: id(m.into) })),
    mergeNotes: out.mergeNotes.map((m) => ({
      fromId: id(m.from),
      intoId: id(m.into),
      text: m.text?.trim() || null,
    })),
    topics: out.topics
      .filter((t) => t.name.trim() || t.concept)
      .map((t) => ({
        conceptId: opt(t.concept),
        name: t.name.trim(),
        children: t.children.map(id),
      })),
    placeNotes: out.placeNotes.map((p) => ({ noteId: id(p.note), conceptId: id(p.concept) })),
    edges: out.edges.map((e) => ({ fromId: id(e.from), toId: id(e.to), why: e.why.trim() })),
    openQuestions: out.openQuestions
      .filter((q) => q.question.trim())
      .slice(0, 5)
      .map((q) => ({ conceptId: opt(q.concept), question: q.question.trim() })),
  }
}

export const consolidatePrompt: PromptSpec<ConsolidateInput, LlmConsolidate, ConsolidateOutput> = {
  id: 'P13',
  task: 'consolidate',
  version: 1,
  tier: 'reason',
  temperature: 0.2,
  maxOutputTokens: 5000,
  reasoningEffort: 'low',
  schemaName: 'consolidation',
  schema: LlmConsolidate,
  onDeviceOk: false,
  cacheable: false,
  language: (input) =>
    input.language && input.language !== 'auto'
      ? input.language.slice(0, 2)
      : looksFinnish(input.notes.map((n) => n.text).join('\n'))
        ? 'fi'
        : 'en',
  build: (input) => ({ system: SYSTEM, user: buildConsolidateUser(input) }),
  finalize: finalizeConsolidate,
}
