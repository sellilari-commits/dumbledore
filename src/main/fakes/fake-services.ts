/**
 * Small fakes for the remaining services the shell calls: prompts (suggest / improve), subject
 * commands, follow-ups, provider health and an in-memory secret store. Real implementations come
 * from lanes L2–L5 and replace these in compose.ts.
 */
import type { Brain, SuggestCandidate } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type {
  ChatContext,
  FollowUpService,
  MemoryControl,
  PromptService,
  Repos,
  StudyService,
  SubjectService,
} from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { createMemoryControl } from '@engine/subjects'
import type { Assignment, Concept, Encounter, Id, Note, Subject } from '@shared/domain'
import type { ProviderId } from '@shared/llm'
import type { NewAssignmentInput, NewSubjectInput, SubjectPatch, SubjectTree } from '@shared/state'
import type { ProviderService, ProviderTestResult, SecretKey, SecretStore } from '../services'

const DAY = 86_400_000

export class FakePromptService implements PromptService {
  constructor(
    private readonly deps: { brain: Brain; repos: Repos; clock: Clock; study: StudyService },
  ) {}

  async suggest(ctx: ChatContext): Promise<{ prompt: string; coachTip: string | null }> {
    const out = await this.deps.brain.suggestPrompt({
      assistant: ctx.assistant ?? 'ChatGPT',
      language: 'auto',
      profile: this.deps.repos.profile.get().summary,
      candidates: this.candidates(),
      context: ctx.pageContext.slice(-600),
    })
    return { prompt: out.prompt, coachTip: out.coachTip }
  }

  async improve(
    draft: string,
    ctx: ChatContext,
  ): Promise<{ prompt: string; coachTip: string | null }> {
    const out = await this.deps.brain.improvePrompt({
      assistant: ctx.assistant ?? 'ChatGPT',
      language: 'auto',
      profile: this.deps.repos.profile.get().summary,
      draft,
      context: ctx.pageContext.slice(-600),
    })
    return { prompt: out.prompt, coachTip: out.coachTip }
  }

  /** Session step › open question › struggling concept › due review › starter. */
  private candidates(): SuggestCandidate[] {
    const { repos, clock, study } = this.deps
    const out: SuggestCandidate[] = []
    const session = study.current()
    const step = session?.items[session.index + 1] ?? session?.items[session.index]
    if (step?.kind === 'learn') out.push({ kind: 'session_step', text: step.promptDraft })
    const focusId = repos.settings.get().focusSubjectId
    const subjects = repos.subjects.list({ status: ['active'] })
    const ordered = [...subjects].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0))
    for (const s of ordered) {
      const q = repos.encounters.openQuestions(s.id, 1)[0]
      if (q) {
        out.push({ kind: 'open_question', text: q })
        break
      }
    }
    const struggling = repos.concepts.listStruggling(1)[0]
    if (struggling) out.push({ kind: 'struggling', text: `Help me finally get ${struggling.name}` })
    const due = repos.concepts.listDue(clock.nowIso(), 1)[0]
    if (due) out.push({ kind: 'due_review', text: `Quiz me on ${due.name}` })
    out.push({ kind: 'starter', text: 'Help me plan how to learn this topic' })
    return out
  }
}

export class FakeSubjectService implements SubjectService {
  private readonly control: MemoryControl

  constructor(private readonly repos: Repos) {
    this.control = createMemoryControl(repos)
  }

  tree(subjectId: Id): SubjectTree {
    return this.control.tree(subjectId)
  }

  looseNotes(): Note[] {
    return this.control.looseNotes()
  }

  updateNote(id: Id, text: string): Note {
    return this.control.updateNote(id, text)
  }

  deleteNote(id: Id): Note {
    return this.control.deleteNote(id)
  }

  fileNote(id: Id, subjectId: Id, conceptId: Id | null): Note {
    return this.control.fileNote(id, subjectId, conceptId)
  }

  updateConcept(id: Id, patch: { name?: string; summary?: string }): Concept {
    return this.control.updateConcept(id, patch)
  }

  deleteConcept(id: Id): Concept {
    return this.control.deleteConcept(id)
  }

  deleteEncounter(id: Id): Encounter {
    return this.control.deleteEncounter(id)
  }

  create(input: NewSubjectInput): Subject {
    return this.repos.subjects.create({
      name: input.name,
      emoji: input.emoji ?? undefined,
      goal: input.goal,
      deadline: input.deadline,
    })
  }

  update(id: Id, patch: SubjectPatch): Subject {
    return this.repos.subjects.update(id, patch)
  }

  remove(id: Id): void {
    this.repos.subjects.remove(id)
    if (this.repos.settings.get().focusSubjectId === id)
      this.repos.settings.update({ focusSubjectId: null })
  }

  actSuggested(subjectId: Id, action: 'accept' | 'dismiss' | 'merge', intoId: Id | null): void {
    if (action === 'merge') {
      if (!intoId) throw new Error('Merging needs a target subject')
      this.repos.subjects.merge(subjectId, intoId)
      return
    }
    this.repos.subjects.update(subjectId, { status: action === 'accept' ? 'active' : 'archived' })
  }

  actInbox(encounterId: Id, action: 'accept' | 'ignore' | 'assign', subjectId: Id | null): void {
    if (action === 'ignore') this.repos.encounters.setInboxState(encounterId, 'ignored')
    else if (action === 'accept') this.repos.encounters.setInboxState(encounterId, 'accepted')
    else {
      if (!subjectId) throw new Error('Assigning needs a subject')
      this.repos.encounters.setInboxState(encounterId, 'accepted', subjectId)
    }
  }

  addAssignment(input: NewAssignmentInput): Assignment {
    return this.repos.assignments.upsert({
      subjectId: input.subjectId,
      title: input.title,
      dueAt: input.dueAt,
      source: 'manual',
    })
  }
}

export class FakeFollowUpService implements FollowUpService {
  constructor(private readonly deps: { repos: Repos; clock: Clock; bus: EngineBus }) {}

  start(): void {}

  stop(): void {}

  onSessionComplete(roadmapId: Id): void {
    const { repos, clock } = this.deps
    const roadmap = repos.roadmaps.get(roadmapId)
    if (!roadmap) return
    const when = new Date(clock.now() + DAY).toISOString()
    const names = new Set(roadmap.items.flatMap((i) => (i.kind === 'learn' ? i.concepts : [])))
    const ids: Id[] = []
    for (const name of names) {
      const concept = repos.concepts.upsert({ subjectId: roadmap.subjectId, name })
      repos.concepts.update(concept.id, { nextReviewAt: when, box: Math.max(1, concept.box) })
      ids.push(concept.id)
    }
    this.deps.bus.emit('memory:changed', { scope: 'concepts', ids })
  }

  dueSummary(): { count: number; conceptIds: Id[] } {
    const due = this.deps.repos.concepts.listDue(this.deps.clock.nowIso(), 50)
    return { count: due.length, conceptIds: due.map((c) => c.id) }
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<SecretKey, string>()

  set(key: SecretKey, value: string): void {
    if (value.trim() === '') this.values.delete(key)
    else this.values.set(key, value.trim())
  }

  get(key: SecretKey): string | null {
    return this.values.get(key) ?? null
  }

  has(key: SecretKey): boolean {
    return this.values.has(key)
  }
}

export class FakeProviderService implements ProviderService {
  constructor(private readonly secrets: SecretStore) {}

  async test(id: ProviderId): Promise<ProviderTestResult> {
    if (id === 'apple') {
      return { ok: false, latencyMs: null, error: 'The on-device model is not available here' }
    }
    if ((id === 'gemini' || id === 'groq' || id === 'mistral') && !this.secrets.has(id)) {
      return { ok: false, latencyMs: null, error: 'No API key set' }
    }
    return { ok: true, latencyMs: 180, error: null }
  }

  status(): { ready: boolean; onDevice: boolean; providers: { id: string; ok: boolean }[] } {
    return {
      ready: true,
      onDevice: false,
      providers: [
        { id: 'gemini', ok: this.secrets.has('gemini') },
        { id: 'apple', ok: false },
        { id: 'groq', ok: this.secrets.has('groq') },
        { id: 'ovh', ok: true },
        { id: 'mistral', ok: this.secrets.has('mistral') },
      ],
    }
  }
}
