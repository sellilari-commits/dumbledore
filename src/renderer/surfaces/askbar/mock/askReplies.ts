/**
 * Fixtures for the Ask bar's browser mock: canned Dumbledore replies picked by keywords, an
 * earlier conversation to seed (`?seed=<turns>`) for the long-chat screenshots, and the prompt
 * the prompt box "writes". The tool-using chat's replies are scripted too: "rename … and mark step
 * 3 done" (two receipts with Undo), "delete …" (a confirmation chip) and "look up …" / "search …"
 * (an answer with its web sources as links).
 */
import type { CoachAction } from '@shared/domain'
import type { AskResult } from '@shared/state'
import { ASK_RESULT } from '../../overlay/mock/fixtures'

interface Canned {
  test: RegExp
  reply: string
  actions: CoachAction[]
}

const EXAM: CoachAction = {
  type: 'create_exam',
  spec: { subjectIds: ['sub_chem'], count: 5, focus: 'weak', difficulty: 'mixed' },
}

/** Receipts of the scripted tool writes (undo_save with the write's receipt line). */
export const TOOL_RECEIPTS: CoachAction[] = [
  { type: 'undo_save', saveId: 'undo_rename', label: 'Renamed “Causal graphs” → “DAGs”' },
  {
    type: 'undo_save',
    saveId: 'undo_step',
    label: 'Marked step 3 “Backdoor criterion” of Causal inference done',
  },
]

/** The scripted delete waiting for the student's go-ahead. */
export const DELETE_CHIP: CoachAction = {
  type: 'run_tool',
  tool: 'delete',
  input: { kind: 'note', id: 'note_colliders' },
  label: 'Delete note “Colliders open a path when you condition on them”',
}

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
    test: /delete|remove/i,
    reply:
      'That note is the only one on **Colliders**. Press the button below if you want it gone.',
    actions: [DELETE_CHIP],
  },
  {
    test: /look up|search|latest/i,
    reply: `A **backdoor path** is any path from treatment to outcome that starts with an arrow *into* the treatment. Blocking every one of them (without opening a collider) is enough to read the causal effect off the data.\n\nSources: ${SOURCES.map((s) => `[${s.title}](${s.url})`).join(' · ')}`,
    actions: [],
  },
  { test: /recursion/i, reply: ASK_RESULT.reply, actions: ASK_RESULT.actions },
  {
    test: /quiz|test me|check me/i,
    reply:
      'Here’s a **5-question check** on moles and molar mass, weighted toward the mix-ups you just described. It takes about 4 minutes.',
    actions: [EXAM],
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
    actions: [{ type: 'start_review', conceptIds: ['c_limiting'] }],
  },
  {
    test: /mole|stoich|molar/i,
    reply:
      'A **mole** is a count, like a dozen: 6.022 × 10²³ particles. **Molar mass** (g/mol) turns grams into that count:\n\n- `n = m / M` — moles = mass ÷ molar mass\n- 18 g of water ÷ 18 g/mol = **1 mol** of H₂O\n\nThe usual slip is using the mass of one atom instead of the whole formula. Want me to put that first on your roadmap?',
    actions: [
      {
        type: 'adjust_roadmap',
        subjectId: 'sub_chem',
        instruction: 'Drill grams-to-moles with whole formulas before moving on',
      },
    ],
  },
  {
    test: /chem/i,
    reply:
      'Happy to help with chemistry. Where does it get fuzzy — **moles and stoichiometry**, **bonding**, or **reaction rates**? Tell me what you’re working on and I’ll start from what you already know.',
    actions: [{ type: 'start_roadmap', subjectId: null, goal: 'Chemistry basics' }],
  },
  {
    test: /focus|what should/i,
    reply:
      '1. **Moles** — you mixed up mass and moles twice this week.\n2. **Limiting reagents** — due for review today.\n3. **Organic Chemistry**, step 4 of 8 — keep it moving while it’s fresh.',
    actions: [{ type: 'start_review', conceptIds: ['c_moles', 'c_limiting'] }],
  },
]

export function cannedReply(text: string): AskResult {
  const hit = CANNED.find((c) => c.test.test(text))
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
