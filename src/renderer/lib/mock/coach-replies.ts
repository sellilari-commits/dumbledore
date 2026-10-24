/**
 * Canned coach replies for the mock chat and Ask bar: picks an answer and action chips from
 * keywords in the student's message, using the demo data so the advice looks real.
 */
import type { CoachAction } from '@shared/domain'
import type { MockDb } from './db'
import { dueConcepts } from './derive'

export interface CannedReply {
  content: string
  actions: CoachAction[]
}

export function coachReply(db: MockDb, text: string): CannedReply {
  const t = text.toLowerCase()
  const active = db.subjects.filter((s) => s.status === 'active')
  const focus = active.find((s) => s.id === db.settings.focusSubjectId) ?? active[0]
  const struggling = db.concepts.find((c) => c.status === 'struggling' && c.subjectId === focus?.id)

  if (active.length === 0)
    return {
      content:
        'I don’t know what you’re studying yet. Tell me a subject — or just say what you want to understand — and I’ll build a roadmap from where you are.',
      actions: [{ type: 'start_roadmap', subjectId: null, goal: text.trim() || 'Something new' }],
    }

  if (/(quiz|exam|test me|check me)/.test(t)) {
    const ids = focus ? [focus.id] : active.map((s) => s.id)
    return {
      content: `Here’s a 5-question check on **${focus?.name ?? 'your subjects'}**, weighted toward what you missed recently. Takes about 4 minutes.`,
      actions: [
        {
          type: 'create_exam',
          spec: { subjectIds: ids, count: 5, focus: 'weak', difficulty: 'mixed' },
        },
      ],
    }
  }

  if (/(don.?t get|understand|explain|learn|confus|roadmap|how does|why)/.test(t)) {
    const goal = text
      .replace(/^(i (don.?t|do not) (get|understand)|explain|help me (understand|learn))\s*/i, '')
      .trim()
    return {
      content: `Let’s make a short roadmap for **${goal || 'this'}**. I’ll start from what you already know, write each prompt for ChatGPT, and check you with a quick quiz after every two or three steps.`,
      actions: [{ type: 'start_roadmap', subjectId: focus?.id ?? null, goal: goal || text }],
    }
  }

  const due = dueConcepts(db).slice(0, 3)
  const lines = [
    struggling
      ? `1. **${struggling.name}** — missed ${struggling.struggleCount} times recently; it unlocks the next steps.`
      : `1. **${focus?.name}** — keep your roadmap moving while it’s fresh.`,
    due.length
      ? `2. **${due.length} review${due.length > 1 ? 's' : ''} due**: ${due.map((c) => `*${c.name}*`).join(', ')}.`
      : '2. No reviews due today — nice.',
    '3. Five minutes of retrieval beats twenty minutes of re-reading.',
  ]
  const actions: CoachAction[] = []
  if (struggling)
    actions.push({ type: 'start_roadmap', subjectId: struggling.subjectId, goal: struggling.name })
  if (due.length) actions.push({ type: 'start_review', conceptIds: due.map((c) => c.id) })
  return { content: `Here’s what I’d do next:\n\n${lines.join('\n')}`, actions }
}

/** Splits text into small chunks that look like streamed tokens. */
export function streamChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

export function fixPromptFor(misconceptions: string[], assistantTopic: string): string {
  const list = misconceptions.map((m, i) => `${i + 1}. I thought: “${m}”`).join('\n')
  return `I'm revising ${assistantTopic} and got these wrong:\n${list}\nFor each, explain in two lines why my idea is wrong and what is right, with one concrete example. No greetings; short bullets, max ~150 words, bold key terms. Then quiz me with 2 new questions and wait for my answers.`
}
