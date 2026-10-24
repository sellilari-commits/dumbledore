/**
 * Fake engine answers for the mock driver: a four-question carbocation checkpoint (quiz.get /
 * quiz.answer / quiz.finish) and an Ask bar reply with action chips.
 */
import type { AnswerResult, Question, Quiz, QuizResult } from '@shared/domain'
import type { AskResult } from '@shared/state'

const q = (
  id: string,
  conceptName: string,
  stem: string,
  options: string[],
  correctIndex: number,
  rationales: string[],
): Question => ({
  id,
  conceptName,
  conceptId: null,
  stem,
  options,
  correctIndex,
  rationales,
  difficulty: 2,
  carriedFrom: null,
})

export const QUESTIONS: Question[] = [
  q(
    'q1',
    'Carbocation stability',
    'Which carbocation is the most stable?',
    ['Methyl (CH₃⁺)', 'Primary (RCH₂⁺)', 'Secondary (R₂CH⁺)', 'Tertiary (R₃C⁺)'],
    3,
    [
      'Methyl has no alkyl groups to share the positive charge, so it is the least stable.',
      'One alkyl group helps a little, but primary cations are still very unstable.',
      'Two alkyl groups help, but three help more.',
      'Three alkyl groups donate electron density through hyperconjugation and induction.',
    ],
  ),
  q(
    'q2',
    'Hyperconjugation',
    'Why do alkyl groups stabilise a carbocation?',
    [
      'They donate electron density into the empty p orbital',
      'They make the carbon more electronegative',
      'They block the nucleophile from attacking',
      'They add extra hydrogen atoms to lose',
    ],
    0,
    [
      'Neighbouring C–H and C–C bonds overlap with the empty p orbital and spread the charge.',
      'Alkyl groups are mildly electron-donating, not withdrawing.',
      'Crowding affects the attack, not how stable the cation itself is.',
      'Counting hydrogens does not explain the charge being spread out.',
    ],
  ),
  q(
    'q3',
    'Resonance',
    'Why is an allylic carbocation unusually stable?',
    [
      'Resonance spreads the positive charge over two carbons',
      'The double bond withdraws electrons inductively',
      'It is surrounded by bulky groups',
      'It hydrogen-bonds with the solvent',
    ],
    0,
    [
      'The neighbouring π bond delocalises the charge across two carbons.',
      'Induction from a C=C bond is weak; resonance is what matters here.',
      'Bulk around the cation is not the reason.',
      'Carbocations do not hydrogen-bond with the solvent this way.',
    ],
  ),
  q(
    'q4',
    'Rearrangements',
    'A primary carbocation forms next to a tertiary carbon. What usually happens next?',
    [
      'It stays put and reacts slowly',
      'A hydride or methyl shift moves the charge to the tertiary carbon',
      'It passes its charge to the solvent',
      'It turns into a carbanion',
    ],
    1,
    [
      'Carbocations rearrange quickly when a more stable cation is one shift away.',
      'A 1,2-shift turns it into the far more stable tertiary cation.',
      'The solvent stabilises the cation but does not take the charge.',
      'Gaining two electrons is not a step that happens here.',
    ],
  ),
]

export function demoQuiz(id: string, answers: Map<string, number>): Quiz {
  return {
    id,
    kind: 'checkpoint',
    title: 'Checkpoint 1 · Carbocation stability',
    subjectIds: ['sub_orgo'],
    roadmapId: 'rm_sn1',
    roadmapItemId: 'item_cp1',
    status: 'ready',
    questions: QUESTIONS,
    answers: [...answers].map(([questionId, chosenIndex]) => ({
      questionId,
      chosenIndex,
      correct: QUESTIONS.find((x) => x.id === questionId)?.correctIndex === chosenIndex,
      answeredAt: new Date(0).toISOString(),
    })),
    score: null,
    createdAt: new Date(0).toISOString(),
    completedAt: null,
  }
}

export function answerOf(questionId: string, chosenIndex: number): AnswerResult {
  const question = QUESTIONS.find((x) => x.id === questionId)
  if (!question) throw new Error(`Unknown question ${questionId}`)
  return {
    correct: chosenIndex === question.correctIndex,
    correctIndex: question.correctIndex,
    rationale: question.rationales[chosenIndex] ?? '',
  }
}

export function resultOf(quizId: string, answers: Map<string, number>): QuizResult {
  const graded = QUESTIONS.map((x) => ({ x, ok: answers.get(x.id) === x.correctIndex }))
  const correct = graded.filter((g) => g.ok).length
  const missed = graded.filter((g) => !g.ok)
  return {
    quizId,
    score: correct / QUESTIONS.length,
    correct,
    total: QUESTIONS.length,
    byConcept: graded.map(({ x, ok }) => ({
      conceptName: x.conceptName,
      correct: ok ? 1 : 0,
      total: 1,
      status: ok ? 'mastered' : 'struggling',
    })),
    gaps: missed.map(({ x }) => ({
      concept: x.conceptName,
      misconception:
        x.id === 'q1'
          ? 'you treat secondary carbocations as the most stable'
          : `you missed why: ${x.rationales[x.correctIndex] ?? ''}`,
    })),
    fixPrompt: missed.length
      ? `I just got these wrong in a quiz: ${missed.map(({ x }) => x.conceptName).join(', ')}. Explain each in 3 short bullet points with one worked example, then ask me one question to check.`
      : null,
    nextTopic: 'SN1 mechanism',
  }
}

export const ASK_REPLY = `Recursion is a function solving a problem by calling **itself on a smaller piece** of it, until it reaches a case it can answer directly.

- **Base case**: the smallest input, answered without recursing, e.g. \`factorial(0) = 1\`.
- **Recursive step**: shrink the problem and trust the call, \`n * factorial(n - 1)\`.

Let's build it up in five short steps, starting with tracing \`factorial(3)\` by hand.`

export const ASK_RESULT: AskResult = {
  reply: ASK_REPLY,
  actions: [
    { type: 'start_roadmap', subjectId: null, goal: 'Understand recursion from the ground up' },
    {
      type: 'insert_prompt',
      text: 'Trace factorial(3) step by step, showing the call stack at each step.',
    },
  ],
  pasted: false,
}
