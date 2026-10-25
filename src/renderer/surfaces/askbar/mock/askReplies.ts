/**
 * Fixtures for the Ask bar's browser mock: canned Dumbledore replies picked by keywords, an
 * earlier conversation to seed (`?seed=<turns>`) for the long-chat screenshots, and the prompt
 * the prompt box "writes". The tool-using chat's replies are scripted too: "rename … and mark step
 * 3 done" (two receipts with Undo), "delete …" (a plain question; "yes" next deletes, with a
 * receipt and Undo), "write me a prompt …" with no AI chat open (opens ChatGPT and pastes: a
 * receipt without Undo), "create me a course on graph neural networks" (one clear question;
 * "new course" next plans it, with a receipt) and "look up …" / "search …" (an answer with its
 * web sources as links). No chips or buttons: only receipt rows under a reply.
 */
import type { CoachAction } from '@shared/domain'
import type { AskResult } from '@shared/state'
import { ASK_REPLY } from '../../overlay/mock/fixtures'

interface Canned {
  test: RegExp
  /** Only right after this reply of Dumbledore's (a follow-up answer such as "yes"). */
  after?: RegExp
  reply: string
  actions: CoachAction[]
}

/** A receipt without Undo (empty saveId): a plain row. */
const done = (label: string): CoachAction => ({ type: 'undo_save', saveId: '', label })

/** Receipts of the scripted tool writes (undo_save with the write's receipt line). */
export const TOOL_RECEIPTS: CoachAction[] = [
  { type: 'undo_save', saveId: 'undo_rename', label: 'Renamed “Causal graphs” → “DAGs”' },
  {
    type: 'undo_save',
    saveId: 'undo_step',
    label: 'Marked step 3 “Backdoor criterion” of Causal inference done',
  },
]

const NOTE = 'Colliders open a path when you condition on them'

/** The delete's plain question, as the delete tool words it. */
export const DELETE_QUESTION = `Delete the note “${NOTE}” from Statistics? Say yes to delete it.`

/** The receipt of the delete after the student's "yes". */
export const DELETE_RECEIPT: CoachAction = {
  type: 'undo_save',
  saveId: 'undo_delete',
  label: `Deleted note “${NOTE}”`,
}

/** The clear question when a new course could also go into an existing one. */
export const COURSE_QUESTION =
  'Add Graph Neural Networks to your Neural Networks course, or make it a new course?'

export const SOURCES = [
  { title: 'Causal Inference: What If (Hernán & Robins)', url: 'https://example.org/what-if' },
  { title: 'The Book of Why, ch. 4', url: 'https://example.org/book-of-why' },
]

const CANNED: Canned[] = [
  {
    test: /rename|mark step/i,
    reply: 'Done — the topic has its shorter name, and step 3 is ticked off. Step 4 is next.',
    actions: TOOL_RECEIPTS,
  },
  {
    test: /^\s*(yes|yep|ok|sure)\b/i,
    after: /^Delete the note/,
    reply: 'Deleted. Colliders has no notes left; add one when you next read about them.',
    actions: [DELETE_RECEIPT],
  },
  {
    test: /new/i,
    after: /^Add Graph Neural Networks/,
    reply:
      'I’m planning **Graph Neural Networks** as a new course. I’ll tell you here when the roadmap is ready.',
    actions: [done('Planning a roadmap for “Graph Neural Networks”')],
  },
  { test: /delete|remove/i, reply: DELETE_QUESTION, actions: [] },
  { test: /graph neural|course on/i, reply: COURSE_QUESTION, actions: [] },
  {
    test: /prompt/i,
    reply: 'ChatGPT wasn’t open, so I opened it with the prompt in the box. Read it, then send.',
    actions: [done('Opened ChatGPT and pasted')],
  },
  {
    test: /look up|search|latest/i,
    reply: `A **backdoor path** is any path from treatment to outcome that starts with an arrow *into* the treatment. Blocking every one of them (without opening a collider) is enough to read the causal effect off the data.\n\nSources: ${SOURCES.map((s) => `[${s.title}](${s.url})`).join(' · ')}`,
    actions: [],
  },
  { test: /recursion/i, reply: ASK_REPLY, actions: [] },
  {
    test: /quiz|test me|check me/i,
    reply:
      'Here’s a **5-question check** on moles and molar mass, weighted toward the mix-ups you just described. It takes about 4 minutes.',
    actions: [done('Created a 5-question exam and opened it')],
  },
  {
    test: /avogadro|6\.022/i,
    reply:
      'It’s just the number of atoms in **12 g of carbon-12**. Chemists picked it so that a mole of any element weighs its atomic mass in grams — that’s the whole trick that lets you go from a balance to a particle count.',
    actions: [],
  },
  {
    test: /limiting/i,
    reply:
      'The **limiting reagent** runs out first, so it decides how much product you get.\n\n1. Convert every reactant to moles.\n2. Divide by its coefficient in the balanced equation.\n3. The smallest result is the limiting one.\n\nTry it with 2 H₂ + O₂ → 2 H₂O and 3 mol of each.',
    actions: [],
  },
  {
    test: /mole|stoich|molar/i,
    reply:
      'A **mole** is a count, like a dozen: 6.022 × 10²³ particles. **Molar mass** (g/mol) turns grams into that count:\n\n- `n = m / M` — moles = mass ÷ molar mass\n- 18 g of water ÷ 18 g/mol = **1 mol** of H₂O\n\nThe usual slip is using the mass of one atom instead of the whole formula. Want me to put that first on your roadmap?',
    actions: [],
  },
  {
    test: /chem/i,
    reply:
      'Happy to help with chemistry. Where does it get fuzzy — **moles and stoichiometry**, **bonding**, or **reaction rates**? Tell me what you’re working on and I’ll start from what you already know.',
    actions: [],
  },
  {
    test: /focus|what should/i,
    reply:
      '1. **Moles** — you mixed up mass and moles twice this week.\n2. **Limiting reagents** — due for review today.\n3. **Organic Chemistry**, step 4 of 8 — keep it moving while it’s fresh.',
    actions: [],
  },
]

/** The canned reply to `text`; `previous` is Dumbledore's last reply (for "yes", "new course"). */
export function cannedReply(text: string, previous = ''): AskResult {
  const hit = CANNED.find((c) => c.test.test(text) && (!c.after || c.after.test(previous)))
  // The double-tap chat never pastes into the AI chat.
  const pasted = false
  if (hit) return { reply: hit.reply, actions: hit.actions, pasted }
  return {
    reply:
      'Good question. Tell me what you already know about it, and I’ll fill the gap with one short example — then we can turn it into a roadmap if it’s bigger than it looks.',
    actions: [],
    pasted,
  }
}

/** Questions of the seeded earlier conversation, oldest first. */
export const SEED_QUESTIONS = [
  'chemistry',
  'moles — I keep mixing up mass and moles',
  'why 6.022 × 10²³ though?',
  'and limiting reagents?',
  'ok, what should I focus on this week?',
  'quiz me on moles',
]

/** The prompt box's canned result: the student's wish, written up as a prompt. */
export function cannedPrompt(context: string): string {
  return `I'm a second-year chemistry student. ${context.trim()} Explain it step by step with one worked example, then ask me one question to check I understood.`
}
