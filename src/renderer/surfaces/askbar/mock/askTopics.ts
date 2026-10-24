/**
 * Mock topics for the Ask bar's topic row: enough subjects that the row overflows 560 pt, so the
 * carousel's fades and arrows show. `?topics=0` leaves them out (the plain bar).
 */
import type { PickerData, SessionState } from '@shared/state'

const SUBJECTS: Array<{ id: string; name: string; emoji: string; daysAgo: number | null }> = [
  { id: 'sub_chem', name: 'Organic chemistry', emoji: '🧪', daysAgo: 0 },
  { id: 'sub_calc', name: 'Calculus II', emoji: '📐', daysAgo: 1 },
  { id: 'sub_hist', name: 'Cold War history', emoji: '🌍', daysAgo: 2 },
  { id: 'sub_algo', name: 'Algorithms', emoji: '🧮', daysAgo: 3 },
  { id: 'sub_bio', name: 'Cell biology', emoji: '🧬', daysAgo: 5 },
  { id: 'sub_span', name: 'Spanish B1', emoji: '🗣️', daysAgo: 8 },
  { id: 'sub_econ', name: 'Microeconomics', emoji: '📈', daysAgo: 13 },
  { id: 'sub_phys', name: 'Thermodynamics', emoji: '🔥', daysAgo: 21 },
  { id: 'sub_phil', name: 'Ethics', emoji: '⚖️', daysAgo: null },
]

export function demoTopics(now = Date.now()): PickerData {
  const iso = (days: number) => new Date(now - days * 86_400_000).toISOString()
  return {
    subjects: SUBJECTS.map((s) => ({
      subject: {
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        color: 'default',
        description: '',
        goal: null,
        deadline: null,
        status: 'active',
        focus: 'normal',
        createdAt: iso(40),
        updatedAt: iso(s.daysAgo ?? 40),
        progress: 0.4,
        mastery: 0.5,
        dueReviews: 0,
        openQuestions: 0,
        studyMinutesWeek: 0,
        lastStudiedAt: s.daysAgo === null ? null : iso(s.daysAgo),
      },
      questions: [],
      hasActiveRoadmap: s.daysAgo !== null,
    })),
  }
}

/** What `session.start` answers in the mock: the subject's roadmap, a step ready to paste. */
export function demoSession(subjectId: string): SessionState {
  const s = SUBJECTS.find((x) => x.id === subjectId)
  if (!s) throw new Error('No such subject')
  return {
    roadmapId: `road_${s.id}`,
    subjectId: s.id,
    subjectName: s.name,
    subjectEmoji: s.emoji,
    title: s.name,
    phase: 'step',
    index: 0,
    total: 0,
    items: [],
    nextAction: 'paste_next',
    assistant: 'ChatGPT',
    startReason: '',
    offerPlacement: false,
    error: null,
  }
}
