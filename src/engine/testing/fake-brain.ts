/**
 * Deterministic Brain for tests, the UI demo and offline development.
 *
 * Every method returns plausible, schema-valid output derived from its input. Override any
 * method per test: `new FakeBrain({ buildRoadmap: async () => myPlan })`. Calls are recorded in
 * `calls` for assertions.
 */
import type { TeachingMove } from '@shared/domain'
import type {
  Brain,
  CallOptions,
  CheckpointInput,
  CoachEvent,
  CoachInput,
  ExamInput,
  ExtractInput,
  ExtractOutput,
  GapInput,
  GapOutput,
  ImproveInput,
  NudgeInput,
  NudgeOutput,
  ProfileInput,
  ProfileOutput,
  PromptWithTip,
  QuestionDraft,
  RoadmapInput,
  RoadmapPlan,
  StepInput,
  StepOutput,
  SuggestInput,
  SuggestOutput,
  VerifyResult,
} from '../brain-contract'

type BrainMethod = keyof Brain
export type BrainOverrides = Partial<{ [K in BrainMethod]: Brain[K] }>

const BREVITY = 'No greetings or small talk. Answer in short structured bullets, max ~150 words.'

function questionFor(concept: string, i: number, difficulty = 2): QuestionDraft {
  const correctIndex = i % 4
  const options = [0, 1, 2, 3].map((k) =>
    k === correctIndex ? `The accurate statement about ${concept}` : `A common misconception about ${concept} (#${k + 1})`,
  )
  return {
    concept,
    stem: `Which statement about ${concept} is correct?`,
    options,
    correctIndex,
    rationales: options.map((_, k) =>
      k === correctIndex ? `This matches how ${concept} works.` : 'Plausible, but it confuses cause and effect.',
    ),
    difficulty,
  }
}

export class FakeBrain implements Brain {
  readonly calls: { method: BrainMethod; input: unknown }[] = []

  constructor(private readonly overrides: BrainOverrides = {}) {}

  private record(method: BrainMethod, input: unknown): void {
    this.calls.push({ method, input })
  }

  async extract(input: ExtractInput, opts?: CallOptions): Promise<ExtractOutput> {
    this.record('extract', input)
    if (this.overrides.extract) return this.overrides.extract(input, opts)
    return {
      results: input.episodes.map((ep) => {
        const isLearning = ep.text.trim().length >= 200
        const topic = ep.title?.split(/[-–|]/)[0]?.trim() || ep.app
        const subject = input.subjects[0]
        return {
          episodeId: ep.id,
          isLearning,
          confidence: isLearning ? 0.8 : 0.7,
          reason: isLearning ? 'Course-like explanatory text' : 'Too little content',
          items: isLearning
            ? [
                {
                  subject: subject ? { matchId: subject.id, newName: null } : { matchId: null, newName: topic },
                  topicPath: [subject?.name ?? topic, topic],
                  seen: ep.text.trim().slice(0, 200),
                  bigPicture: `Trying to understand ${topic}.`,
                  understanding:
                    ep.signals.scrollBacks >= 3
                      ? { status: 'struggling' as const, evidence: `Scrolled back ${ep.signals.scrollBacks} times` }
                      : { status: 'unknown' as const, evidence: '' },
                  openQuestions: [`How does ${topic} work?`],
                  keyTerms: [topic],
                  assignment: null,
                },
              ]
            : [],
          studentPrompts: [],
        }
      }),
    }
  }

  async buildRoadmap(input: RoadmapInput, opts?: CallOptions): Promise<RoadmapPlan> {
    this.record('buildRoadmap', input)
    if (this.overrides.buildRoadmap) return this.overrides.buildRoadmap(input, opts)
    const g = input.goal
    const learn = (title: string, concept: string, move: TeachingMove) => ({
      kind: 'learn' as const,
      title,
      objective: `Can explain ${concept}`,
      concepts: [concept],
      move,
      promptDraft: `I'm studying ${g}. Explain ${concept} in 3 numbered points with one concrete example. ${BREVITY} Then ask me one question to check I got it, and wait.`,
    })
    return {
      title: `${g} — from the basics`,
      goal: g,
      startReason:
        input.mastery.length > 0
          ? `You already know ${input.mastery[0]?.concept}; we start with what is still shaky.`
          : 'No history yet, so we start from the essentials.',
      offerPlacement: input.mastery.length === 0,
      estimatedMinutes: 25,
      items: [
        learn(`What ${g} is`, `${g} basics`, 'intuition'),
        learn(`How ${g} works`, `${g} mechanism`, 'worked_example'),
        {
          kind: 'checkpoint',
          covers: [`${g} basics`, `${g} mechanism`, ...input.carry],
          probes: [{ concept: `${g} mechanism`, misconception: 'Confusing cause and effect' }],
          nQuestions: Math.min(5, 3 + input.carry.length),
        },
        learn(`Use ${g}`, `${g} application`, 'apply'),
        {
          kind: 'checkpoint',
          covers: [`${g} basics`, `${g} mechanism`, `${g} application`],
          probes: [{ concept: `${g} application`, misconception: 'Applying the rule outside its limits' }],
          nQuestions: 3,
        },
      ],
      nextMilestone: null,
    }
  }

  async writeStep(input: StepInput, opts?: CallOptions): Promise<StepOutput> {
    this.record('writeStep', input)
    if (this.overrides.writeStep) return this.overrides.writeStep(input, opts)
    const misses = input.recentMisses.map((m) => ` I thought "${m.misconception}" — explain why that's wrong.`).join('')
    return {
      prompt: `${input.step.promptDraft}${misses}`,
      coachTip: 'Asking for numbered points and a check question keeps answers short and active.',
      memoryUpdates: [],
    }
  }

  async makeCheckpoint(input: CheckpointInput, opts?: CallOptions): Promise<QuestionDraft[]> {
    this.record('makeCheckpoint', input)
    if (this.overrides.makeCheckpoint) return this.overrides.makeCheckpoint(input, opts)
    const pool = [...input.carry, ...input.concepts]
    return Array.from({ length: input.n }, (_, i) => questionFor(pool[i % pool.length] ?? 'the topic', i))
  }

  async verifyQuestions(questions: QuestionDraft[], opts?: CallOptions): Promise<VerifyResult[]> {
    this.record('verifyQuestions', questions)
    if (this.overrides.verifyQuestions) return this.overrides.verifyQuestions(questions, opts)
    return questions.map((q, index) => ({ index, chosen: q.correctIndex, confidence: 0.9 }))
  }

  async makeExam(input: ExamInput, opts?: CallOptions): Promise<QuestionDraft[]> {
    this.record('makeExam', input)
    if (this.overrides.makeExam) return this.overrides.makeExam(input, opts)
    const names = input.concepts.map((c) => c.name)
    const pool = names.length > 0 ? names : input.subjects.map((s) => s.name)
    const difficulty = input.spec.difficulty === 'easy' ? 1 : input.spec.difficulty === 'hard' ? 3 : 2
    return Array.from({ length: input.spec.count }, (_, i) => questionFor(pool[i % pool.length] ?? 'the subject', i, difficulty))
  }

  async fixGaps(input: GapInput, opts?: CallOptions): Promise<GapOutput> {
    this.record('fixGaps', input)
    if (this.overrides.fixGaps) return this.overrides.fixGaps(input, opts)
    const concepts = [...new Set(input.misses.map((m) => m.concept))]
    return {
      diagnoses: input.misses.map((m) => ({ concept: m.concept, misconception: `Chose "${m.chosen}"` })),
      prompt: `I keep getting ${concepts.join(' and ')} wrong. For each, contrast the wrong idea with the right one and give one example. ${BREVITY} Then quiz me with 2 new questions and wait for my answers.`,
      nextTopic: concepts[0] ? `${concepts[0]} in practice` : 'Next chapter',
    }
  }

  async improvePrompt(input: ImproveInput, opts?: CallOptions): Promise<PromptWithTip> {
    this.record('improvePrompt', input)
    if (this.overrides.improvePrompt) return this.overrides.improvePrompt(input, opts)
    return {
      prompt: `I'm a student learning this topic. ${input.draft.trim()} Explain in 3 numbered points with an example. ${BREVITY}`,
      coachTip: 'What I improved: added your level, a structure and a length limit.',
    }
  }

  async suggestPrompt(input: SuggestInput, opts?: CallOptions): Promise<SuggestOutput> {
    this.record('suggestPrompt', input)
    if (this.overrides.suggestPrompt) return this.overrides.suggestPrompt(input, opts)
    const first = input.candidates[0]
    return {
      prompt: `${first?.text ?? 'Help me plan how to learn this'}. ${BREVITY}`,
      coachTip: 'Starting from your open question keeps the chat focused.',
      basedOn: first?.kind ?? 'starter',
    }
  }

  coach(input: CoachInput, opts?: CallOptions): AsyncIterable<CoachEvent> {
    this.record('coach', input)
    if (this.overrides.coach) return this.overrides.coach(input, opts)
    const wantsToLearn = /\b(understand|learn|don'?t get|explain)\b/i.test(input.message)
    const reply = wantsToLearn
      ? "Let's build a roadmap for that first — I'll start where you are."
      : 'Focus on your weakest concept first, then do a 5-minute review.'
    return (async function* () {
      for (const word of reply.split(' ')) yield { type: 'text' as const, delta: `${word} ` }
      if (wantsToLearn) {
        yield {
          type: 'action' as const,
          action: { type: 'start_roadmap' as const, subjectId: null, goal: input.message },
        }
      }
      yield { type: 'done' as const }
    })()
  }

  async writeNudge(input: NudgeInput, opts?: CallOptions): Promise<NudgeOutput> {
    this.record('writeNudge', input)
    if (this.overrides.writeNudge) return this.overrides.writeNudge(input, opts)
    return { title: 'Quick check?', body: input.facts.slice(0, 80) }
  }

  async buildProfile(input: ProfileInput, opts?: CallOptions): Promise<ProfileOutput> {
    this.record('buildProfile', input)
    if (this.overrides.buildProfile) return this.overrides.buildProfile(input, opts)
    return { summary: input.aboutMe || 'Student', level: null, habitsToCoach: ['Give context in prompts'] }
  }
}
