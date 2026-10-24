/**
 * Demo question bank and quizzes for the mock API: a finished weak-spots exam (7/10), yesterday's
 * review that created the carried concept, and a ready Linear Algebra exam to take.
 */
import type { Answer, Question, Quiz } from '@shared/domain'
import { DAY, HOUR, isoAgo } from './time'

type Four = [string, string, string, string]

function q(
  id: string,
  concept: [string, string],
  stem: string,
  options: Four,
  correctIndex: number,
  rationales: Four,
  difficulty = 2,
): Question {
  return {
    id,
    conceptId: concept[0],
    conceptName: concept[1],
    stem,
    options,
    correctIndex,
    rationales,
    difficulty,
    carriedFrom: null,
  }
}

const CARBO: [string, string] = ['con_carbocation', 'Carbocation stability']
const SN1: [string, string] = ['con_sn1', 'SN1 mechanism']
const SN2: [string, string] = ['con_sn2', 'SN2 mechanism']
const LEAVE: [string, string] = ['con_leaving', 'Leaving groups']
const NUC: [string, string] = ['con_nucleophiles', 'Nucleophiles']
const SOLV: [string, string] = ['con_solvent', 'Solvent effects']
const EIGEN: [string, string] = ['con_eigen', 'Eigenvalues & eigenvectors']
const DET: [string, string] = ['con_det', 'Determinants']
const INDEP: [string, string] = ['con_independence', 'Linear independence']
const MATMUL: [string, string] = ['con_matmul', 'Matrix multiplication']
const PLATES: [string, string] = ['con_plates', 'Plate tectonics']
const SUBD: [string, string] = ['con_subduction', 'Subduction zones']

/** Questions by subject id; exams.create draws from here. */
export function questionBank(): Record<string, Question[]> {
  return {
    sub_orgo: [
      q(
        'q_o1',
        CARBO,
        'Which carbocation is the most stable?',
        ['Methyl (CH₃⁺)', 'Primary (1°)', 'Secondary (2°)', 'Tertiary (3°)'],
        3,
        [
          'No alkyl groups donate electron density — the least stable.',
          'One alkyl group gives only a little stabilisation.',
          'Two alkyl groups help, but three help more.',
          'Three alkyl groups donate the most electron density.',
        ],
        1,
      ),
      q(
        'q_o2',
        CARBO,
        'Why does hyperconjugation stabilise a carbocation?',
        [
          'Neighbouring C–H σ bonds donate electron density into the empty p orbital',
          'The solvent removes the positive charge',
          'The cationic carbon becomes sp³',
          'Alkyl groups pull electrons away from the cation',
        ],
        0,
        [
          'Right: overlap with the empty p orbital spreads the charge.',
          'Solvation helps, but it is not hyperconjugation.',
          'A carbocation is sp², with an empty p orbital.',
          'Alkyl groups donate electrons; they do not withdraw them.',
        ],
      ),
      q(
        'q_o3',
        SN1,
        'You double the nucleophile concentration in an SN1 reaction. What happens to the rate?',
        ['It doubles', 'It halves', 'It stays the same', 'It quadruples'],
        2,
        [
          'That is SN2 behaviour: rate = k[R–X][Nu].',
          'Adding nucleophile never slows the reaction.',
          'Right: rate = k[R–X]; the nucleophile is not in the slow step.',
          'No step involves two nucleophiles.',
        ],
      ),
      q(
        'q_o4',
        LEAVE,
        'Which halide is the best leaving group?',
        ['F⁻', 'Cl⁻', 'Br⁻', 'I⁻'],
        3,
        [
          'F⁻ is the strongest base here, so it leaves worst.',
          'Better than F⁻, but still a fairly strong base.',
          'Good, but I⁻ is a weaker base still.',
          'Right: the weakest base is the most stable on its own.',
        ],
        1,
      ),
      q(
        'q_o5',
        SN2,
        '(R)-2-bromobutane reacts with OH⁻ by SN2. The product is…',
        ['(R)-butan-2-ol', '(S)-butan-2-ol', 'A racemic mixture', 'No reaction'],
        1,
        [
          'Backside attack flips the configuration.',
          'Right: backside attack inverts the stereocentre.',
          'Racemisation comes from a planar carbocation (SN1).',
          'A secondary bromide does react with OH⁻.',
        ],
      ),
      q(
        'q_o6',
        SN2,
        'Which substrate reacts fastest by SN2?',
        ['CH₃Br', '(CH₃)₂CHBr', '(CH₃)₃CBr', '(CH₃)₃CCH₂Br'],
        0,
        [
          'Right: least hindered, so the backside is open.',
          'Secondary: slower, more crowded.',
          'Tertiary: too hindered for backside attack.',
          'Neopentyl: the bulky neighbour blocks attack.',
        ],
      ),
      q(
        'q_o7',
        SOLV,
        'Which solvent favours SN1?',
        ['Acetone', 'DMSO', 'Water/ethanol', 'Hexane'],
        2,
        [
          'Polar aprotic: favours SN2.',
          'Polar aprotic: favours SN2.',
          'Right: polar protic solvents stabilise the carbocation and leaving group.',
          'Non-polar: neither ion is stabilised.',
        ],
      ),
      q(
        'q_o8',
        NUC,
        'In a polar aprotic solvent, which is the strongest nucleophile?',
        ['F⁻', 'Cl⁻', 'Br⁻', 'I⁻'],
        0,
        [
          'Right: unsolvated, the strongest base is the best nucleophile.',
          'Weaker base than F⁻ here.',
          'Weaker base than Cl⁻.',
          'Best in protic solvents, not aprotic ones.',
        ],
        3,
      ),
      q(
        'q_o9',
        CARBO,
        'A friend says a primary carbocation is stable because nothing crowds it. What is wrong?',
        [
          'Nothing — crowding is the main factor',
          'Stability comes from electron donation, which primary cations lack',
          'Primary cations are stabilised only by solvent',
          'Crowding makes cations more stable',
        ],
        1,
        [
          'Crowding matters for SN2 attack, not cation stability.',
          'Right: fewer alkyl groups means less donation, so less stable.',
          'Solvent helps every cation; it does not explain the order.',
          'Bulk itself is not what stabilises a cation.',
        ],
        3,
      ),
      q(
        'q_o10',
        SN1,
        'Why can SN1 reactions give rearranged products?',
        [
          'The carbocation can shift a hydride or methyl to become more stable',
          'The nucleophile attacks twice',
          'The leaving group comes back',
          'SN1 is a concerted step',
        ],
        0,
        [
          'Right: 1,2-shifts turn a less stable cation into a more stable one.',
          'Each nucleophile attacks once.',
          'Recombination gives back the start, not a rearrangement.',
          'SN1 is stepwise; SN2 is concerted.',
        ],
      ),
    ],
    sub_linalg: [
      q(
        'q_l1',
        EIGEN,
        'If Av = 3v for a non-zero vector v, then…',
        [
          'v is an eigenvector with eigenvalue 3',
          'A = 3I',
          'det(A) = 3',
          'v is in the null space of A',
        ],
        0,
        [
          'Right: that is the definition of an eigenpair.',
          'Only if every vector were scaled by 3.',
          'The determinant is the product of all eigenvalues.',
          'Null-space vectors satisfy Av = 0.',
        ],
        1,
      ),
      q(
        'q_l2',
        EIGEN,
        'What are the eigenvalues of the diagonal matrix [[2, 0], [0, 5]]?',
        ['2 and 5', '0 and 7', '10 only', '2 only'],
        0,
        [
          'Right: a diagonal matrix has its eigenvalues on the diagonal.',
          '7 is the trace, not an eigenvalue.',
          '10 is the determinant.',
          'Both diagonal entries are eigenvalues.',
        ],
        1,
      ),
      q(
        'q_l3',
        DET,
        'det(A) = 0 tells you that…',
        [
          'A is invertible',
          'The columns of A are linearly dependent',
          'A is the identity',
          'Every entry of A is 0',
        ],
        1,
        [
          'A zero determinant means A is not invertible.',
          'Right: A squashes space into a lower dimension.',
          'det(I) = 1.',
          'Many non-zero matrices have det 0.',
        ],
      ),
      q(
        'q_l4',
        INDEP,
        'Any three vectors in ℝ² are…',
        [
          'always linearly independent',
          'always linearly dependent',
          'independent if none is zero',
          'independent if they are orthogonal',
        ],
        1,
        [
          'ℝ² has dimension 2, so three vectors cannot be independent.',
          'Right: more vectors than dimensions forces dependence.',
          'Non-zero is not enough.',
          'Three vectors in ℝ² cannot all be orthogonal.',
        ],
      ),
      q(
        'q_l5',
        MATMUL,
        'A is 2×3 and B is 3×4. What size is AB?',
        ['3×3', '2×4', '4×2', 'Undefined'],
        1,
        [
          'Inner sizes cancel; outer sizes remain.',
          'Right: (2×3)(3×4) = 2×4.',
          'That would be BᵀAᵀ.',
          'The inner sizes match, so it is defined.',
        ],
        1,
      ),
      q(
        'q_l6',
        EIGEN,
        'Why does a 90° rotation of the plane have no real eigenvectors?',
        [
          'Every non-zero vector changes direction',
          'Its determinant is 0',
          'It is not square',
          'Its trace is 1',
        ],
        0,
        [
          'Right: no direction stays on its own span.',
          'A rotation has determinant 1.',
          'Rotation matrices are 2×2.',
          'Its trace is 0, and trace alone does not decide this.',
        ],
        3,
      ),
    ],
    sub_geo: [
      q(
        'q_g1',
        SUBD,
        'Subduction happens when…',
        [
          'an oceanic plate sinks beneath another plate',
          'two continental plates slide past each other',
          'magma rises at a mid-ocean ridge',
          'a plate splits in two',
        ],
        0,
        [
          'Right: the denser oceanic plate goes under.',
          'That is a transform boundary.',
          'That is a divergent boundary.',
          'That is rifting.',
        ],
        1,
      ),
      q(
        'q_g2',
        PLATES,
        'Roughly how fast do tectonic plates move?',
        ['2–10 cm a year', '2–10 m a year', '2–10 km a year', 'They do not move'],
        0,
        [
          'Right: about as fast as fingernails grow.',
          'A hundred times too fast.',
          'Far too fast.',
          'GPS measures their motion every day.',
        ],
        1,
      ),
    ],
  }
}

function answers(questions: Question[], wrong: Record<string, number>, at: string): Answer[] {
  return questions.map((qq) => {
    const chosen = wrong[qq.id] ?? qq.correctIndex
    return {
      questionId: qq.id,
      chosenIndex: chosen,
      correct: chosen === qq.correctIndex,
      answeredAt: at,
    }
  })
}

export function demoQuizzes(): Quiz[] {
  const bank = questionBank()
  const orgo = bank.sub_orgo ?? []
  const linalg = bank.sub_linalg ?? []
  const examDone = isoAgo(2 * DAY + 3 * HOUR)
  const reviewDone = isoAgo(21 * HOUR)
  const reviewQs = orgo.filter((x) => x.conceptName === 'Carbocation stability')
  return [
    {
      id: 'quiz_orgo_weak',
      kind: 'exam',
      title: 'Weak-spots exam · Organic Chemistry',
      subjectIds: ['sub_orgo'],
      roadmapId: null,
      roadmapItemId: null,
      status: 'done',
      questions: orgo,
      answers: answers(orgo, { q_o2: 2, q_o9: 0, q_o7: 1 }, examDone),
      score: 0.7,
      createdAt: isoAgo(2 * DAY + 4 * HOUR),
      completedAt: examDone,
    },
    {
      id: 'quiz_review_carbo',
      kind: 'review',
      title: '5-minute review · Carbocations',
      subjectIds: ['sub_orgo'],
      roadmapId: null,
      roadmapItemId: null,
      status: 'done',
      questions: reviewQs,
      answers: answers(reviewQs, { q_o2: 1, q_o9: 0 }, reviewDone),
      score: 1 / 3,
      createdAt: isoAgo(21 * HOUR + 10 * 60_000),
      completedAt: reviewDone,
    },
    {
      id: 'quiz_linalg_ready',
      kind: 'exam',
      title: 'Due reviews · Linear Algebra',
      subjectIds: ['sub_linalg'],
      roadmapId: null,
      roadmapItemId: null,
      status: 'ready',
      questions: linalg.slice(0, 5),
      answers: [],
      score: null,
      createdAt: isoAgo(50 * 60_000),
      completedAt: null,
    },
  ]
}
