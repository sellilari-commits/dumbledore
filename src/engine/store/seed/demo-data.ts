/**
 * Static content of the demo database: concepts and encounters, with times given relative to
 * "now" so the seeded data always looks current (due reviews are due, recent things are recent).
 * The tables are kept compact on purpose (formatter disabled for them).
 */
import type { InboxState, MasteryStatus, UnderstandingStatus } from '@shared/domain'

export type DemoSubjectKey = 'orgo' | 'la' | 'geo'

export interface DemoConcept {
  subject: DemoSubjectKey
  name: string
  parent: string | null
  summary: string
  mastery: number
  status: MasteryStatus
  box: number
  /** Hours from now until the next review (negative = overdue); null = not scheduled. */
  reviewInHours: number | null
  lastSeenHoursAgo: number | null
  struggle: number
}

type ConceptRow = [
  DemoSubjectKey,
  string,
  string | null,
  string,
  number,
  MasteryStatus,
  number,
  number | null,
  number | null,
  number,
]

// biome-ignore format: data table
const CONCEPT_ROWS: ConceptRow[] = [
  // subject, name, parent, summary, mastery, status, box, reviewInHours, lastSeenHoursAgo, struggle
  ['orgo', 'Nucleophilic substitution', null, 'A nucleophile replaces a leaving group.', 0.55, 'learning', 2, null, 24, 0],
  ['orgo', 'Nucleophiles & electrophiles', 'Nucleophilic substitution', 'Electron-pair donors attack electron-poor centres.', 0.82, 'learning', 3, 120, 50, 0],
  ['orgo', 'Leaving groups', 'Nucleophilic substitution', 'Weak bases leave best: I⁻ > Br⁻ > Cl⁻ ≫ F⁻.', 0.74, 'learning', 2, -20, 26, 0],
  ['orgo', 'SN1 mechanism', 'Nucleophilic substitution', 'Two steps via a carbocation; rate = k[R–X].', 0.45, 'learning', 1, 48, 2, 0],
  ['orgo', 'SN2 mechanism', 'Nucleophilic substitution', 'One concerted step with backside attack and inversion.', 0.9, 'mastered', 4, 384, 25, 0],
  ['orgo', 'Carbocation stability', null, 'Tertiary > secondary > primary, thanks to hyperconjugation.', 0.28, 'struggling', 1, -2, 3, 2],
  ['orgo', 'Hyperconjugation', 'Carbocation stability', 'Neighbouring C–H bonds donate into the empty p orbital.', 0.1, 'new', 0, null, 3, 0],
  ['orgo', 'Stereochemistry', null, 'The 3-D arrangement of atoms in molecules.', 0.45, 'learning', 1, null, 96, 0],
  ['orgo', 'Chirality', 'Stereochemistry', 'A carbon with four different groups is a stereocentre.', 0.6, 'learning', 2, -72, 96, 0],
  ['orgo', 'R/S nomenclature', 'Stereochemistry', 'Rank by CIP priority, view with the lowest group away.', 0.35, 'learning', 1, 24, 120, 1],
  ['orgo', 'E1 vs E2 eliminations', null, 'Eliminations compete with substitutions.', 0.05, 'new', 0, null, 144, 0],
  ['orgo', 'Leaving-group ability and pKa', 'Leaving groups', 'The weaker the conjugate base, the better it leaves.', 0.5, 'learning', 1, 72, 26, 0],
  ['la', 'Vectors', null, 'Arrows with magnitude and direction; lists of numbers.', 0.88, 'mastered', 4, 480, 168, 0],
  ['la', 'Matrix multiplication', null, 'Composition of linear maps.', 0.76, 'learning', 3, -6, 144, 0],
  ['la', 'Gaussian elimination', null, 'Row-reduce to solve linear systems.', 0.62, 'learning', 2, 72, 48, 0],
  ['la', 'Linear independence', null, 'No vector is a combination of the others.', 0.4, 'learning', 1, 24, 72, 0],
  ['la', 'Span and basis', null, 'A basis is an independent spanning set.', 0.33, 'learning', 1, 36, 96, 0],
  ['la', 'Determinants', null, 'How a linear map scales area/volume.', 0.5, 'learning', 2, -24, 24, 0],
  ['la', 'Eigenvalues and eigenvectors', null, 'Av = λv: directions a map only stretches.', 0.22, 'struggling', 1, 0, 5, 3],
  ['la', 'Diagonalization', 'Eigenvalues and eigenvectors', 'A = PDP⁻¹ when there are enough eigenvectors.', 0.05, 'new', 0, null, 240, 0],
  ['geo', 'Monsoon climate', null, 'Seasonal wind reversal brings heavy summer rain.', 0.1, 'new', 0, null, 20, 0],
  ['geo', 'Plate tectonics', null, 'Lithospheric plates move over the mantle.', 0, 'new', 0, null, 22, 0],
]

export const DEMO_CONCEPTS: DemoConcept[] = CONCEPT_ROWS.map(
  ([
    subject,
    name,
    parent,
    summary,
    mastery,
    status,
    box,
    reviewInHours,
    lastSeenHoursAgo,
    struggle,
  ]) => ({
    subject,
    name,
    parent,
    summary,
    mastery,
    status,
    box,
    reviewInHours,
    lastSeenHoursAgo,
    struggle,
  }),
)

export type DemoApp = 'Chrome' | 'Preview' | 'ChatGPT' | 'Safari' | 'Notes'

export const APP_BUNDLES: Record<DemoApp, string> = {
  Chrome: 'com.google.Chrome',
  Preview: 'com.apple.Preview',
  ChatGPT: 'com.openai.chat',
  Safari: 'com.apple.Safari',
  Notes: 'com.apple.Notes',
}

export interface DemoEncounter {
  subject: DemoSubjectKey | null
  concept: string | null
  hoursAgo: number
  app: DemoApp
  minutes: number
  understanding: UnderstandingStatus
  inbox: InboxState
  url: string | null
  title: string
  seen: string
  bigPicture: string
  evidence: string
  topicPath: string[]
  openQuestions?: string[]
  keyTerms?: string[]
}

const ORGO = 'Organic Chemistry'
const LA = 'Linear Algebra'

// biome-ignore format: data table
export const DEMO_ENCOUNTERS: DemoEncounter[] = [
  { subject: null, concept: null, hoursAgo: 0.5, app: 'Chrome', minutes: 5, understanding: 'unclear', inbox: 'new',
    url: 'https://en.wikipedia.org/wiki/Calvin_cycle', title: 'Calvin cycle – Wikipedia',
    seen: 'The Calvin cycle fixes CO₂ into G3P using ATP and NADPH from the light reactions.',
    bigPicture: 'How plants build sugar.', evidence: 'Scrolled back to the diagram twice.',
    topicPath: ['Biology', 'Photosynthesis', 'Calvin cycle'], openQuestions: ['Where does the Calvin cycle get its ATP?'], keyTerms: ['RuBisCO', 'G3P'] },
  { subject: 'orgo', concept: 'SN1 mechanism', hoursAgo: 2, app: 'Chrome', minutes: 6, understanding: 'struggling', inbox: 'new',
    url: 'https://en.wikipedia.org/wiki/SN1_reaction', title: 'SN1 reaction – Wikipedia',
    seen: 'rate = k[R–X]; tertiary substrates favour SN1 because their carbocations are most stable.',
    bigPicture: 'Working out when each mechanism happens, for the midterm.',
    evidence: 'Re-read the stability paragraph 3×; asked ChatGPT "why are tertiary carbocations more stable".',
    topicPath: [ORGO, 'Nucleophilic substitution', 'SN1 vs SN2'], openQuestions: ['How does hyperconjugation stabilise a carbocation?'], keyTerms: ['carbocation', 'rate-determining step'] },
  { subject: 'orgo', concept: 'Carbocation stability', hoursAgo: 3, app: 'ChatGPT', minutes: 9, understanding: 'struggling', inbox: 'new',
    url: null, title: 'Carbocation stability',
    seen: 'Hyperconjugation: neighbouring C–H bonds donate electron density into the empty p orbital.',
    bigPicture: 'Why more substituted carbocations are more stable.', evidence: 'Asked the same question twice in different words.',
    topicPath: [ORGO, 'Carbocations', 'Stability'], openQuestions: ['Why does hyperconjugation count more than induction?', 'Are allylic carbocations more stable than tertiary ones?'], keyTerms: ['hyperconjugation', 'inductive effect'] },
  { subject: 'la', concept: 'Eigenvalues and eigenvectors', hoursAgo: 5, app: 'Chrome', minutes: 16, understanding: 'struggling', inbox: 'new',
    url: 'https://www.3blue1brown.com/lessons/eigenvalues', title: 'Eigenvectors and eigenvalues | Chapter 14',
    seen: 'An eigenvector stays on its own span; the eigenvalue is how much it is stretched.',
    bigPicture: 'Building intuition for eigenvectors before the exam.', evidence: 'Rewound the shear example 4× and asked ChatGPT for another example.',
    topicPath: [LA, 'Eigenvalues'], openQuestions: ['Why do eigenvectors stay on their own span?', 'How do I find eigenvalues of a 3×3 matrix by hand?'], keyTerms: ['eigenvalue', 'span'] },
  { subject: null, concept: null, hoursAgo: 6, app: 'Safari', minutes: 4, understanding: 'understood', inbox: 'new',
    url: 'https://writing.example.edu/lab-reports', title: 'How to write a lab report',
    seen: 'A lab report has abstract, introduction, methods, results and discussion.',
    bigPicture: 'Preparing the chemistry lab report.', evidence: 'Read once at a steady pace.',
    topicPath: ['Academic writing', 'Lab reports'] },
  { subject: 'geo', concept: 'Monsoon climate', hoursAgo: 20, app: 'Chrome', minutes: 8, understanding: 'understood', inbox: 'new',
    url: 'https://en.wikipedia.org/wiki/Monsoon', title: 'Monsoon – Wikipedia',
    seen: 'Monsoons are seasonal reversals of wind driven by land–sea temperature differences.',
    bigPicture: 'Curious about why South Asia gets summer rain.', evidence: 'Read once, no scroll-backs.',
    topicPath: ['Geography', 'Climate', 'Monsoon'], openQuestions: ['Why does the monsoon reverse direction in winter?'] },
  { subject: 'geo', concept: 'Plate tectonics', hoursAgo: 22, app: 'Chrome', minutes: 6, understanding: 'unclear', inbox: 'new',
    url: 'https://education.nationalgeographic.org/plate-tectonics', title: 'Plate tectonics',
    seen: 'Plates meet at divergent, convergent and transform boundaries.',
    bigPicture: 'Background reading on how mountains form.', evidence: 'Scrolled back to the convergent-boundary figure.',
    topicPath: ['Geography', 'Geology', 'Plate tectonics'] },
  { subject: 'la', concept: 'Determinants', hoursAgo: 24, app: 'ChatGPT', minutes: 9, understanding: 'unclear', inbox: 'accepted',
    url: null, title: 'Determinant intuition',
    seen: 'The determinant is the factor by which a linear map scales area.',
    bigPicture: 'Making sense of determinants geometrically.', evidence: 'Asked for the geometric meaning twice.',
    topicPath: [LA, 'Determinants'], openQuestions: ['Why is det(AB) = det(A)·det(B)?'] },
  { subject: 'orgo', concept: 'SN2 mechanism', hoursAgo: 25, app: 'Preview', minutes: 14, understanding: 'understood', inbox: 'accepted',
    url: null, title: 'Lecture 7 – Substitution.pdf',
    seen: 'SN2 proceeds by backside attack with inversion of configuration (Walden inversion).',
    bigPicture: 'Lecture 7 review before the problem set.', evidence: 'Steady reading, no scroll-backs.',
    topicPath: [ORGO, 'Nucleophilic substitution', 'SN2'], keyTerms: ['backside attack', 'inversion'] },
  { subject: 'orgo', concept: 'Leaving groups', hoursAgo: 26, app: 'Chrome', minutes: 7, understanding: 'unclear', inbox: 'accepted',
    url: 'https://www.khanacademy.org/science/organic-chemistry/leaving-groups', title: 'Leaving groups | Khan Academy',
    seen: 'Good leaving groups are weak bases: I⁻ > Br⁻ > Cl⁻ ≫ F⁻.',
    bigPicture: 'What makes a reaction go fast.', evidence: 'Scrolled back twice to the pKa table.',
    topicPath: [ORGO, 'Nucleophilic substitution', 'Leaving groups'], openQuestions: ['Why is water a better leaving group than hydroxide?'] },
  { subject: 'orgo', concept: null, hoursAgo: 27, app: 'Chrome', minutes: 3, understanding: 'unknown', inbox: 'accepted',
    url: 'https://canvas.example.edu/courses/2210/assignments/5', title: 'Problem Set 5: SN1/SN2 — due in 3 days',
    seen: 'Problem Set 5 covers SN1/SN2 mechanisms; due in three days.',
    bigPicture: 'Coursework for CHEM 2210.', evidence: 'Assignment page, skimmed.',
    topicPath: [ORGO, 'Coursework'] },
  { subject: 'la', concept: 'Gaussian elimination', hoursAgo: 48, app: 'Preview', minutes: 22, understanding: 'understood', inbox: 'accepted',
    url: null, title: 'LA Homework 3.pdf',
    seen: 'Row-reduce the augmented matrix to echelon form, then back-substitute.',
    bigPicture: 'Homework 3 on solving linear systems.', evidence: 'Worked through all 4 problems.',
    topicPath: [LA, 'Linear systems', 'Gaussian elimination'] },
  { subject: 'orgo', concept: 'Nucleophiles & electrophiles', hoursAgo: 50, app: 'Chrome', minutes: 5, understanding: 'understood', inbox: 'accepted',
    url: 'https://chem.libretexts.org/nucleophilicity', title: 'Nucleophilicity – LibreTexts',
    seen: 'Nucleophilicity rises down a group in protic solvents.',
    bigPicture: 'Basics of substitution reactions.', evidence: 'Answered the inline check correctly.',
    topicPath: [ORGO, 'Nucleophilic substitution', 'Nucleophiles'] },
  { subject: 'orgo', concept: 'Nucleophiles & electrophiles', hoursAgo: 53, app: 'ChatGPT', minutes: 6, understanding: 'understood', inbox: 'accepted',
    url: null, title: 'Quiz me on nucleophiles',
    seen: 'Strong nucleophiles: HO⁻, RO⁻, CN⁻, I⁻.',
    bigPicture: 'Self-testing before the checkpoint.', evidence: 'Asked ChatGPT to quiz them; 4/5 correct.',
    topicPath: [ORGO, 'Nucleophilic substitution', 'Nucleophiles'] },
  { subject: 'orgo', concept: 'SN1 mechanism', hoursAgo: 72, app: 'Chrome', minutes: 11, understanding: 'unclear', inbox: 'accepted',
    url: 'https://chatgpt.com/c/sn1-vs-sn2', title: 'SN1 vs SN2 – ChatGPT',
    seen: 'SN1: two steps, racemisation; SN2: one step, inversion.',
    bigPicture: 'Comparing the two mechanisms.', evidence: 'Asked ChatGPT to compare SN1 and SN2 in a table.',
    topicPath: [ORGO, 'Nucleophilic substitution', 'SN1 vs SN2'], openQuestions: ['When does a secondary substrate go SN1?'] },
  { subject: 'la', concept: 'Linear independence', hoursAgo: 72, app: 'Chrome', minutes: 7, understanding: 'unclear', inbox: 'accepted',
    url: 'https://www.khanacademy.org/math/linear-algebra/linear-independence', title: 'Linear independence | Khan Academy',
    seen: 'Vectors are independent if only the trivial combination gives zero.',
    bigPicture: 'Foundations for bases.', evidence: 'Paused on the zero-vector example.',
    topicPath: [LA, 'Vector spaces', 'Linear independence'], openQuestions: ['Is a set with the zero vector always dependent?'] },
  { subject: 'orgo', concept: 'Chirality', hoursAgo: 96, app: 'Preview', minutes: 18, understanding: 'unclear', inbox: 'accepted',
    url: null, title: 'Lecture 8 – Stereochemistry.pdf',
    seen: 'A stereocentre is a carbon bonded to four different groups.',
    bigPicture: 'Lecture 8 on stereochemistry.', evidence: 'Slow reading (95 wpm vs 210 baseline).',
    topicPath: [ORGO, 'Stereochemistry', 'Chirality'], openQuestions: ['How do I find chiral centres quickly?'] },
  { subject: 'la', concept: 'Span and basis', hoursAgo: 96, app: 'Chrome', minutes: 6, understanding: 'unclear', inbox: 'accepted',
    url: 'https://www.3blue1brown.com/lessons/span', title: 'Linear combinations, span, and basis vectors',
    seen: 'The span is every vector you can reach with linear combinations.',
    bigPicture: 'Intuition for vector spaces.', evidence: 'Rewatched the 3-D span part.',
    topicPath: [LA, 'Vector spaces', 'Span'] },
  { subject: 'orgo', concept: 'R/S nomenclature', hoursAgo: 120, app: 'Chrome', minutes: 8, understanding: 'struggling', inbox: 'accepted',
    url: 'https://www.youtube.com/watch?v=rs-trick', title: 'R/S nomenclature trick – YouTube',
    seen: 'Rank substituents by atomic number; point the lowest priority away.',
    bigPicture: 'Naming stereocentres for the midterm.', evidence: 'Rewatched the priority-rules part 3×.',
    topicPath: [ORGO, 'Stereochemistry', 'R/S'], openQuestions: ['What if the lowest priority group points toward me?'] },
  { subject: 'la', concept: 'Matrix multiplication', hoursAgo: 144, app: 'Chrome', minutes: 10, understanding: 'understood', inbox: 'accepted',
    url: 'https://www.3blue1brown.com/lessons/matrix-multiplication', title: 'Matrix multiplication as composition',
    seen: 'Multiplying matrices composes their transformations, right to left.',
    bigPicture: 'Why matrix multiplication is defined this way.', evidence: 'Watched once and paraphrased it in notes.',
    topicPath: [LA, 'Matrices', 'Multiplication'] },
  { subject: 'orgo', concept: 'E1 vs E2 eliminations', hoursAgo: 145, app: 'Chrome', minutes: 4, understanding: 'unclear', inbox: 'accepted',
    url: 'https://www.youtube.com/watch?v=e1-e2', title: 'E1 vs E2 – The Organic Chemistry Tutor',
    seen: 'Strong bulky bases favour E2; weak bases and heat favour E1.',
    bigPicture: 'Previewing next week’s lecture.', evidence: 'Stopped halfway.',
    topicPath: [ORGO, 'Eliminations'] },
  { subject: 'la', concept: 'Vectors', hoursAgo: 168, app: 'Preview', minutes: 12, understanding: 'understood', inbox: 'accepted',
    url: null, title: 'Lecture 2 – Vectors.pdf',
    seen: 'Vectors add tip-to-tail and scale by numbers.', bigPicture: 'Course basics.', evidence: 'Steady reading.',
    topicPath: [LA, 'Vectors'] },
  { subject: 'orgo', concept: 'Nucleophilic substitution', hoursAgo: 192, app: 'Notes', minutes: 10, understanding: 'understood', inbox: 'accepted',
    url: null, title: 'Orgo lecture notes',
    seen: 'Substitution swaps a leaving group for a nucleophile.', bigPicture: 'Lecture 6 notes.', evidence: 'Wrote a summary in their own words.',
    topicPath: [ORGO, 'Nucleophilic substitution'] },
  { subject: 'orgo', concept: null, hoursAgo: 216, app: 'Chrome', minutes: 3, understanding: 'unknown', inbox: 'ignored',
    url: 'https://www.reddit.com/r/chemistry', title: 'r/chemistry',
    seen: 'Chemistry memes.', bigPicture: 'Procrastination.', evidence: 'Browsing.',
    topicPath: ['Chemistry memes'] },
  { subject: 'la', concept: 'Diagonalization', hoursAgo: 240, app: 'Chrome', minutes: 5, understanding: 'unknown', inbox: 'accepted',
    url: 'https://en.wikipedia.org/wiki/Diagonalizable_matrix', title: 'Diagonalizable matrix – Wikipedia',
    seen: 'A matrix is diagonalizable if it has n independent eigenvectors.', bigPicture: 'Peeking ahead in the course.', evidence: 'Skimmed.',
    topicPath: [LA, 'Eigenvalues', 'Diagonalization'] },
]
