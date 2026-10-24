/**
 * Turns the roadmapper's plan (P3) into a stored Roadmap: ids, idx, statuses and checkpoint
 * titles ("Checkpoint 1 · 3 questions"). Also enforces the §6.6 rules the plan must follow: the
 * last item is a checkpoint covering the whole roadmap, and checkpoints ask 1–5 questions.
 */
import type { CheckpointItem, Id, LearnItem, Roadmap, RoadmapItem } from '@shared/domain'
import type { RoadmapPlan } from '../../brain-contract'
import { newId } from '../../ids'
import { plural, uniqueBy, uniqueNames } from './text'

export const MAX_QUESTIONS = 5
export const BASE_QUESTIONS = 3

export function checkpointTitle(ordinal: number, nQuestions: number): string {
  return `Checkpoint ${ordinal} · ${plural(nQuestions, 'question')}`
}

/** §6.6: 3 questions + 1 per carried concept, at most 5 — never fewer than planned. */
export function questionsFor(planned: number, carried: number): number {
  return clampQuestions(Math.max(planned, BASE_QUESTIONS + carried))
}

/** A student-prompt (§7) for a step the roadmapper left without a draft. */
export function defaultDraft(goal: string, title: string, objective: string): string {
  return `I'm working on: ${goal.trim()}. Teach me "${title.trim()}" so that I ${objective.trim().replace(/^can\s+/i, 'can ')}. Use 3 numbered points and one concrete example. No greetings or small talk; short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.`
}

export function clampQuestions(n: number): number {
  return Math.min(MAX_QUESTIONS, Math.max(1, Math.round(n)))
}

export interface MaterializeInput {
  id: Id
  subjectId: Id
  plan: RoadmapPlan
  /** Concepts missed before (previous roadmaps), re-tested at the first checkpoint. */
  carry: string[]
  /** True when there is no history at all: always offer the placement check (PLAN R40). */
  noHistory: boolean
  nowIso: string
}

type Draft = RoadmapPlan['items'][number]

export function materializeRoadmap(input: MaterializeInput): Roadmap {
  const { plan } = input
  const drafts: Draft[] = [...plan.items]
  const learnConcepts = uniqueNames(drafts.flatMap((d) => (d.kind === 'learn' ? d.concepts : [])))
  const last = drafts.at(-1)
  if (last?.kind !== 'checkpoint') {
    drafts.push({
      kind: 'checkpoint',
      covers: uniqueNames([...learnConcepts, ...input.carry]).slice(0, 8),
      probes: [],
      nQuestions: questionsFor(BASE_QUESTIONS, input.carry.length),
    })
  }

  let ordinal = 0
  const items: RoadmapItem[] = drafts.map((d, idx): RoadmapItem => {
    const status = idx === 0 ? 'current' : 'todo'
    if (d.kind === 'learn') {
      const item: LearnItem = {
        kind: 'learn',
        id: newId('itm'),
        idx,
        title: d.title.trim(),
        objective: d.objective.trim(),
        concepts: uniqueNames(d.concepts),
        move: d.move,
        promptDraft: d.promptDraft.trim() || defaultDraft(plan.goal, d.title, d.objective),
        promptSent: null,
        status,
      }
      return item
    }
    ordinal++
    const covers = uniqueNames(d.covers.length > 0 ? d.covers : learnConcepts)
    const nQuestions = clampQuestions(d.nQuestions)
    const item: CheckpointItem = {
      kind: 'checkpoint',
      id: newId('itm'),
      idx,
      title: checkpointTitle(ordinal, nQuestions),
      covers,
      probes: uniqueBy(d.probes, (p) => `${p.concept}|${p.misconception}`),
      nQuestions,
      quizId: null,
      score: null,
      status,
    }
    return item
  })

  return {
    id: input.id,
    subjectId: input.subjectId,
    title: plan.title.trim() || plan.goal.trim(),
    goal: plan.goal.trim(),
    startReason: plan.startReason.trim(),
    offerPlacement: plan.offerPlacement || input.noHistory,
    estimatedMinutes: plan.estimatedMinutes,
    status: 'active',
    items,
    carry: uniqueNames(input.carry),
    nextMilestone: plan.nextMilestone,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  }
}
