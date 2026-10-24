/**
 * Demo roadmap and quizzes: an Organic Chemistry roadmap halfway through (checkpoint 1 passed
 * 2/3 with "Carbocation stability" carried), its checkpoint quiz, two finished exams and one
 * finished review quiz.
 */
import type { Answer, Concept, LearnItem, Question, Quiz, Roadmap } from '@shared/domain'
import { newId } from '../../ids'

type Options = [string, string, string, string]
/** concept, stem, options, correct index, chosen index */
type QuestionRow = [string, string, Options, number, number]

// biome-ignore format: data table
const CHECKPOINT: QuestionRow[] = [
  ['Nucleophiles & electrophiles', 'Which is the strongest nucleophile in a protic solvent?', ['F⁻', 'Cl⁻', 'Br⁻', 'I⁻'], 3, 3],
  ['Leaving groups', 'Which is the best leaving group?', ['HO⁻', 'H₂O', 'NH₂⁻', 'CH₃⁻'], 1, 1],
  ['Carbocation stability', 'Which carbocation is most stable?', ['Methyl', 'Primary', 'Secondary', 'Tertiary'], 3, 1],
]

// biome-ignore format: data table
const ORGO_EXAM: QuestionRow[] = [
  ['SN2 mechanism', 'What happens to configuration in SN2?', ['Retention', 'Inversion', 'Racemisation', 'Nothing'], 1, 1],
  ['Leaving groups', 'Good leaving groups are…', ['Strong bases', 'Weak bases', 'Nucleophiles', 'Radicals'], 1, 1],
  ['Carbocation stability', 'Why is a tertiary carbocation stable?', ['Resonance only', 'Hyperconjugation and induction', 'It is not', 'Steric strain'], 1, 0],
  ['SN1 mechanism', 'The SN1 rate law is…', ['k[Nu]', 'k[R–X][Nu]', 'k[R–X]', 'k[Nu]²'], 2, 2],
  ['Chirality', 'A stereocentre has…', ['Two identical groups', 'Four different groups', 'A double bond', 'No hydrogens'], 1, 1],
  ['Nucleophiles & electrophiles', 'Which is an electrophile?', ['CN⁻', 'NH₃', 'CH₃⁺', 'HO⁻'], 2, 2],
  ['Carbocation stability', 'Rank methyl, primary and tertiary carbocations', ['methyl > primary > tertiary', 'tertiary > primary > methyl', 'primary > tertiary > methyl', 'all equal'], 1, 2],
  ['R/S nomenclature', 'CIP priority is decided first by…', ['Mass of the group', 'Atomic number', 'Electronegativity', 'Size'], 1, 1],
  ['Chirality', 'Which molecule is chiral?', ['CH₄', 'CH₂Cl₂', 'CHFClBr', 'CCl₄'], 2, 0],
  ['SN2 mechanism', 'SN2 is fastest for…', ['Tertiary', 'Secondary', 'Primary', 'Aryl'], 2, 2],
]

// biome-ignore format: data table
const LA_EXAM: QuestionRow[] = [
  ['Vectors', 'Adding vectors geometrically means…', ['Multiplying lengths', 'Tip-to-tail', 'Averaging', 'Rotating'], 1, 1],
  ['Matrix multiplication', 'AB applied to v means…', ['A then B', 'B then A', 'Neither', 'Both at once'], 1, 1],
  ['Determinants', 'det = 0 means the map…', ['Is a rotation', 'Squishes space flat', 'Doubles area', 'Is the identity'], 1, 1],
  ['Eigenvalues and eigenvectors', 'An eigenvector of A…', ['Is always zero', 'Stays on its span', 'Is perpendicular to Av', 'Has length 1'], 1, 3],
  ['Gaussian elimination', 'Row operations preserve…', ['The determinant', 'The solution set', 'Eigenvectors', 'Column order'], 1, 1],
]

// biome-ignore format: data table
const REVIEW: QuestionRow[] = [
  ['Leaving groups', 'Why is iodide a good leaving group?', ['Strong base', 'Large, polarisable, weak base', 'Small and hard', 'Positively charged'], 1, 1],
  ['Determinants', 'det(AB) equals…', ['det(A)+det(B)', 'det(A)·det(B)', 'det(A)/det(B)', 'det(BA)²'], 1, 0],
  ['Leaving groups', 'Protonating an –OH group…', ['Makes it a worse leaving group', 'Makes water the leaving group', 'Has no effect', 'Makes it a nucleophile'], 1, 1],
]

const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

function buildQuiz(
  base: Pick<Quiz, 'kind' | 'title' | 'subjectIds' | 'roadmapId' | 'roadmapItemId'>,
  rows: QuestionRow[],
  concept: (name: string) => Concept,
  startedAt: number,
): Quiz {
  const questions: Question[] = rows.map(([name, stem, options, correctIndex]) => ({
    id: newId('qst'),
    conceptName: name,
    conceptId: concept(name).id,
    stem,
    options,
    correctIndex,
    rationales: options.map((o, i) =>
      i === correctIndex ? `Right: ${o}.` : `Not quite — “${o}” is a common mix-up.`,
    ),
    difficulty: 2,
    carriedFrom: null,
  }))
  const answers: Answer[] = rows.map(([, , , correct, chosen], i) => ({
    questionId: questions[i]?.id ?? '',
    chosenIndex: chosen,
    correct: chosen === correct,
    answeredAt: iso(startedAt + (i + 1) * 45_000),
  }))
  return {
    id: newId('quz'),
    ...base,
    status: 'done',
    questions,
    answers,
    score: answers.filter((a) => a.correct).length / answers.length,
    createdAt: iso(startedAt - 60_000),
    completedAt: iso(startedAt + (rows.length + 1) * 45_000),
  }
}

function learnItem(
  id: string,
  idx: number,
  title: string,
  concepts: string[],
  move: LearnItem['move'],
  status: LearnItem['status'],
): LearnItem {
  const prompt = `I'm studying ${title} for my organic chemistry midterm. Explain it with one worked example. No greetings or small talk. Short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.`
  return {
    kind: 'learn',
    id,
    idx,
    title,
    objective: `Explain ${title.toLowerCase()} in your own words`,
    concepts,
    move,
    promptDraft: prompt,
    promptSent: status === 'done' ? prompt : null,
    status,
  }
}

export function demoRoadmapAndQuizzes(
  ids: { orgo: string; la: string },
  concept: (name: string) => Concept,
  now: number,
): { roadmap: Roadmap; quizzes: Quiz[] } {
  const roadmapId = newId('rdm')
  const itemIds = Array.from({ length: 7 }, () => newId('itm'))
  const id = (i: number) => itemIds[i] ?? ''
  const noRoadmap = { roadmapId: null, roadmapItemId: null }

  const checkpoint = buildQuiz(
    {
      kind: 'checkpoint',
      title: 'Checkpoint 1',
      subjectIds: [ids.orgo],
      roadmapId,
      roadmapItemId: id(3),
    },
    CHECKPOINT,
    concept,
    now - 26 * H,
  )
  const covered = ['Nucleophiles & electrophiles', 'Leaving groups', 'Carbocation stability']
  const roadmap: Roadmap = {
    id: roadmapId,
    subjectId: ids.orgo,
    title: 'SN1 vs SN2: when does each happen?',
    goal: 'Predict whether a substitution goes SN1 or SN2',
    startReason: 'You struggled with carbocation stability while reading about SN1.',
    offerPlacement: false,
    estimatedMinutes: 40,
    status: 'active',
    items: [
      learnItem(
        id(0),
        0,
        'Nucleophiles & electrophiles',
        ['Nucleophiles & electrophiles'],
        'definition',
        'done',
      ),
      learnItem(id(1), 1, 'Leaving groups', ['Leaving groups'], 'intuition', 'done'),
      learnItem(
        id(2),
        2,
        'Carbocation stability',
        ['Carbocation stability', 'Hyperconjugation'],
        'worked_example',
        'done',
      ),
      {
        kind: 'checkpoint',
        id: id(3),
        idx: 3,
        title: 'Checkpoint 1',
        covers: covered,
        probes: [
          {
            concept: 'Carbocation stability',
            misconception: 'Primary carbocations are the most stable',
          },
        ],
        nQuestions: 3,
        quizId: checkpoint.id,
        score: checkpoint.score,
        status: 'done',
      },
      learnItem(id(4), 4, 'SN1 mechanism', ['SN1 mechanism'], 'worked_example', 'current'),
      learnItem(id(5), 5, 'SN2 mechanism and inversion', ['SN2 mechanism'], 'contrast', 'todo'),
      {
        kind: 'checkpoint',
        id: id(6),
        idx: 6,
        title: 'Final checkpoint',
        covers: [...covered, 'SN1 mechanism', 'SN2 mechanism'],
        probes: [{ concept: 'SN1 mechanism', misconception: 'SN1 inverts configuration' }],
        nQuestions: 4,
        quizId: null,
        score: null,
        status: 'todo',
      },
    ],
    carry: ['Carbocation stability'],
    nextMilestone: 'Midterm',
    createdAt: iso(now - 30 * H),
    updatedAt: iso(now - 2 * H),
  }

  const quizzes = [
    checkpoint,
    buildQuiz(
      {
        kind: 'exam',
        title: 'Weak-spots exam · Organic Chemistry',
        subjectIds: [ids.orgo],
        ...noRoadmap,
      },
      ORGO_EXAM,
      concept,
      now - 72 * H,
    ),
    buildQuiz(
      {
        kind: 'exam',
        title: 'Everything so far · Linear Algebra',
        subjectIds: [ids.la],
        ...noRoadmap,
      },
      LA_EXAM,
      concept,
      now - 144 * H,
    ),
    buildQuiz(
      {
        kind: 'review',
        title: '5-min review · Leaving groups & Determinants',
        subjectIds: [ids.orgo, ids.la],
        ...noRoadmap,
      },
      REVIEW,
      concept,
      now - 20 * H,
    ),
  ]
  return { roadmap, quizzes }
}
