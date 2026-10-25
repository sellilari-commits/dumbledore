/**
 * Test fixtures for the chat tools (tests only): Ilari's world — Statistics with a paused
 * causal-inference roadmap at step 3 of 6, Machine Learning with an active roadmap, an empty
 * Chemistry — on in-memory repos, with the read models the tools need.
 */
import { FakeClock } from '@engine/clock'
import { createEngineBus } from '@engine/events'
import { createQueryService } from '@engine/queries/query-service'
import { createMemoryControl } from '@engine/subjects/memory-control'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Roadmap, RoadmapItem } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'

export const WORLD_NOW = '2026-10-25T07:20:00.000Z'

export function roadmapItem(
  idx: number,
  title: string,
  status: RoadmapItem['status'],
  kind: RoadmapItem['kind'] = 'learn',
): RoadmapItem {
  const base = { id: `item_${idx}`, idx, title, status }
  return kind === 'learn'
    ? {
        ...base,
        kind,
        objective: `Understand ${title}`,
        concepts: [title],
        move: 'intuition',
        promptDraft: `Explain ${title}`,
        promptSent: null,
      }
    : { ...base, kind, covers: [], probes: [], nQuestions: 3, quizId: null, score: null }
}

export function roadmapOf(
  id: string,
  subjectId: string,
  title: string,
  status: Roadmap['status'],
  items: RoadmapItem[],
  at = WORLD_NOW,
): Roadmap {
  return {
    id,
    subjectId,
    title,
    goal: title,
    startReason: '',
    offerPlacement: false,
    estimatedMinutes: 60,
    status,
    items,
    carry: [],
    nextMilestone: null,
    createdAt: at,
    updatedAt: at,
  }
}

export function chatWorld() {
  const clock = new FakeClock(WORLD_NOW)
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const changes: MemoryChanged[] = []
  bus.on('memory:changed', (e) => changes.push(e))
  const stats = repos.subjects.create({ name: 'Statistics', status: 'active' })
  const ml = repos.subjects.create({ name: 'Machine Learning', status: 'active' })
  const chem = repos.subjects.create({ name: 'Chemistry', status: 'active' })
  const causal = repos.concepts.upsert({ subjectId: stats.id, name: 'Causal Inference' })
  repos.concepts.upsert({ subjectId: stats.id, name: 'Functional Noise Models' })
  repos.concepts.upsert({ subjectId: ml.id, name: 'Neural Networks' })
  repos.roadmaps.save(
    roadmapOf('rdm_causal', stats.id, 'Causal Inference and Functional Noise Models', 'paused', [
      roadmapItem(0, 'Causal Inference vs. Association', 'done'),
      roadmapItem(1, 'Additive vs. General Functional Noise', 'done'),
      roadmapItem(2, 'Checkpoint 1 · 3 questions', 'current', 'checkpoint'),
      roadmapItem(3, 'Heteroskedastic and Post-Nonlinear Models', 'todo'),
      roadmapItem(4, 'Applications in Political Science and Economics', 'todo'),
      roadmapItem(5, 'Checkpoint 2 · 3 questions', 'todo', 'checkpoint'),
    ]),
  )
  repos.roadmaps.save(
    roadmapOf('rdm_nn', ml.id, 'Foundations of Neural Networks', 'active', [
      roadmapItem(0, 'Core Architecture of Neural Networks', 'current'),
      roadmapItem(1, 'Artificial Neurons and Activation Functions', 'todo'),
    ]),
  )
  const queries = createQueryService({ repos, clock, greetingName: 'Ilari' })
  const memory = createMemoryControl(repos)
  return { clock, repos, bus, changes, queries, memory, stats, ml, chem, causal }
}
