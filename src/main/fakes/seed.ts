/**
 * Demo data for the in-memory repos, so the shell shows plausible content before the real store
 * (lane L2a, tools/seed-demo.ts) is wired in. Idempotent: does nothing when subjects exist.
 */
import type { Clock } from '@engine/clock'
import type { Repos } from '@engine/contracts'

const DAY = 86_400_000

export function seedDemo(repos: Repos, clock: Clock): void {
  if (repos.subjects.list().length > 0) return
  const iso = (offsetDays: number) => new Date(clock.now() + offsetDays * DAY).toISOString()

  const orgo = repos.subjects.create({
    name: 'Organic Chemistry',
    emoji: '🧪',
    color: 'green',
    goal: 'Pass the midterm',
    deadline: iso(49),
  })
  const linalg = repos.subjects.create({
    name: 'Linear Algebra',
    emoji: '📐',
    color: 'blue',
    goal: 'Understand eigenvectors',
  })
  repos.subjects.create({ name: 'Cell Biology', emoji: '🧬', status: 'suggested' })

  const concepts: [string, string, number, string, number | null][] = [
    [orgo.id, 'Nucleophiles', 0.82, 'learning', 2],
    [orgo.id, 'Leaving groups', 0.7, 'learning', -1],
    [orgo.id, 'Carbocation stability', 0.3, 'struggling', 0],
    [orgo.id, 'SN1 mechanism', 0.45, 'learning', 1],
    [linalg.id, 'Matrix multiplication', 0.9, 'mastered', 7],
    [linalg.id, 'Eigenvectors', 0.2, 'learning', -2],
  ]
  for (const [subjectId, name, mastery, status, reviewIn] of concepts) {
    const c = repos.concepts.upsert({ subjectId, name })
    repos.concepts.update(c.id, {
      mastery,
      status: status as 'learning' | 'struggling' | 'mastered',
      box: reviewIn === null ? 0 : 2,
      nextReviewAt: reviewIn === null ? null : iso(reviewIn),
      struggleCount: status === 'struggling' ? 2 : 0,
      lastSeenAt: iso(-1),
    })
  }

  repos.encounters.add({
    subjectId: orgo.id,
    conceptId: null,
    episodeId: null,
    seen: 'Rate = k[R–X]; tertiary substrates favour SN1 because their carbocations are most stable.',
    bigPicture:
      'Organic Chemistry › Nucleophilic substitution › SN1 vs SN2 — when each mechanism happens.',
    topicPath: ['Organic Chemistry', 'Nucleophilic substitution', 'SN1 vs SN2'],
    understanding: 'struggling',
    evidence: 'Re-read the stability paragraph 3×',
    openQuestions: [
      'How does hyperconjugation stabilise a carbocation?',
      'Why does SN1 give a racemic mixture?',
    ],
    keyTerms: ['carbocation', 'SN1', 'hyperconjugation'],
    source: {
      app: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      url: 'https://en.wikipedia.org/wiki/SN1_reaction',
      title: 'SN1 reaction - Wikipedia',
    },
    dwellSeconds: 412,
  })
  repos.encounters.add({
    subjectId: linalg.id,
    conceptId: null,
    episodeId: null,
    seen: 'An eigenvector keeps its direction under the transformation: Av = λv.',
    bigPicture: 'Linear Algebra › Eigenvalues — what a matrix does to special directions.',
    topicPath: ['Linear Algebra', 'Eigenvalues and eigenvectors'],
    understanding: 'unclear',
    evidence: 'Asked ChatGPT to explain it more simply',
    openQuestions: ['What does an eigenvalue of 0 mean geometrically?'],
    keyTerms: ['eigenvector', 'eigenvalue'],
    source: { app: 'Preview', bundleId: 'com.apple.Preview', url: null, title: 'Lecture 7.pdf' },
    dwellSeconds: 640,
  })
  repos.assignments.upsert({
    subjectId: orgo.id,
    title: 'Problem set 4: substitution reactions',
    course: 'CHEM-C2110',
    dueAt: iso(5),
    source: 'demo',
  })
  repos.profile.update({
    aboutMe: "I'm a second-year chemistry student.",
    summary: 'Second-year chemistry student; prepares for the organic chemistry midterm.',
  })
  // The demo user is set up, as in the engine's demo seed.
  repos.settings.update({ onboardingDone: true })
}
