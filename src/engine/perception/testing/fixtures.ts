/**
 * Recorded-episode fixtures (tests/fixtures/episodes/*.json): loading with validation, replay
 * through the ScriptedHelper on a FakeClock, and a fixture-driven stand-in for the extractor LLM
 * that answers from what perception actually sent (so signals and text are exercised end to end).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ExtractInput, ExtractOutput } from '../../brain-contract'
import type { FakeClock } from '../../clock'
import { runFor, type ScriptedHelper, type ScriptedWindow } from './scripted-helper'

const Line = z.union([
  z.string(),
  z.object({
    text: z.string(),
    align: z.enum(['left', 'center', 'right']).nullable().optional(),
    conf: z.number().optional(),
  }),
])

const WindowDef = z.object({
  pid: z.number().int(),
  bundleId: z.string(),
  appName: z.string(),
  windowId: z.number().int().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  source: z.enum(['ax', 'ocr']).default('ax'),
})

const Step = z.object({
  at: z.number(), // seconds from the start
  front: z.string().nullable(), // key into `windows`, null = nothing readable in front
  title: z.string().optional(),
  url: z.string().optional(),
  lines: z.array(Line).optional(), // omitted = same text as before
  visible: z.array(z.object({ window: z.string(), lines: z.array(Line) })).optional(),
  idle: z.number().optional(),
})

const BrainSpec = z.object({
  subject: z.string(),
  topicPath: z.array(z.string()).min(1).max(4),
  keyTerms: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  assignment: z
    .object({ title: z.string(), course: z.string().nullable(), dueAt: z.string().nullable() })
    .nullable()
    .default(null),
})

const Expect = z.object({
  blocked: z.boolean().default(false),
  episodes: z.number().int().optional(),
  extractCalls: z.number().int().optional(),
  aiChat: z.string().nullable().optional(),
  main: z
    .object({
      kind: z.enum(['reading', 'ai_chat', 'other']).optional(),
      source: z.enum(['ax', 'ocr', 'mixed']).optional(),
      aiProvider: z.string().nullable().optional(),
      minDwell: z.number().optional(),
      minScrollBacks: z.number().int().optional(),
      searches: z.array(z.string()).optional(),
      aiQuestions: z.array(z.string()).optional(),
      textIncludes: z.array(z.string()).default([]),
      textExcludes: z.array(z.string()).default([]),
    })
    .optional(),
  encounters: z.number().int().default(0),
  understanding: z.enum(['understood', 'unclear', 'struggling', 'unknown']).optional(),
  subject: z.string().optional(),
  concepts: z.array(z.string()).default([]),
  assignment: z.object({ title: z.string(), dueAt: z.string().nullable() }).optional(),
  promptsSeen: z.number().int().optional(),
})

export const EpisodeFixture = z.object({
  name: z.string(),
  description: z.string(),
  start: z.string().default('2026-10-24T09:00:00.000Z'),
  windows: z.record(z.string(), WindowDef),
  timeline: z.array(Step).min(1),
  end: z.number(),
  learning: z.boolean(),
  brain: BrainSpec.optional(),
  expect: Expect,
})
export type EpisodeFixture = z.infer<typeof EpisodeFixture>

const FIXTURE_DIR = fileURLToPath(new URL('../../../../tests/fixtures/episodes/', import.meta.url))

export function loadEpisodeFixtures(): EpisodeFixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => EpisodeFixture.parse(JSON.parse(readFileSync(`${FIXTURE_DIR}${f}`, 'utf8'))))
}

/** Plays the fixture's timeline on the helper, advancing the clock between steps. */
export async function replayFixture(fx: EpisodeFixture, helper: ScriptedHelper, clock: FakeClock): Promise<void> {
  const state = new Map<string, ScriptedWindow>()
  const update = (key: string, patch: { title?: string; url?: string; lines?: ScriptedWindow['lines'] }) => {
    const def = fx.windows[key]
    if (!def) throw new Error(`${fx.name}: unknown window "${key}"`)
    const current = state.get(key) ?? { ...def, lines: [] }
    const next: ScriptedWindow = {
      ...current,
      title: patch.title ?? current.title,
      url: patch.url ?? current.url,
      lines: patch.lines ?? current.lines,
    }
    state.set(key, next)
    return next
  }
  for (const [i, step] of fx.timeline.entries()) {
    helper.front = step.front ? update(step.front, step) : null
    helper.others = (step.visible ?? []).map((v) => update(v.window, { lines: v.lines }))
    helper.idleSeconds = step.idle ?? 0
    const next = fx.timeline[i + 1]?.at ?? fx.end
    await runFor(clock, (next - step.at) * 1000)
  }
}

const QUIZ = /\b(quiz|test) me\b/i
const EXAMPLE = /\bexamples?\b/i
const CONTEXT = /\b(i'm|i am|my (course|class|exam)|for my)\b/i
const STRUCTURE = /(\d\.|\bsteps?\b|\bbullets?\b|\b\d+ (questions|points)\b)/i
const CONFUSED = /(don't get|do not get|simpler|simply|confus)/i

/** A stand-in for the P1 extractor that answers from the fixture's ground truth. */
export function fixtureExtractor(fx: EpisodeFixture) {
  return async (input: ExtractInput): Promise<ExtractOutput> => ({
    results: input.episodes.map((ep) => {
      const spec = fx.learning ? fx.brain : undefined
      const confused = ep.signals.aiQuestions.find((q) => CONFUSED.test(q))
      const struggling = ep.signals.scrollBacks >= 2 || confused !== undefined
      const existing = spec ? input.subjects.find((s) => s.name === spec.subject) : undefined
      return {
        episodeId: ep.id,
        isLearning: spec !== undefined,
        confidence: 0.9,
        reason: spec ? 'study material' : 'not learning',
        items: spec
          ? [
              {
                subject: existing ? { matchId: existing.id, newName: null } : { matchId: null, newName: spec.subject },
                topicPath: spec.topicPath,
                seen: ep.text.replace(/^\[(L|C|R)\] /gm, '').slice(0, 300),
                bigPicture: `Understanding ${spec.topicPath.at(-1)} within ${spec.subject}.`,
                understanding: struggling
                  ? {
                      status: 'struggling' as const,
                      evidence: confused ? `Asked: "${confused}"` : `Scrolled back ${ep.signals.scrollBacks} times`,
                    }
                  : { status: 'unknown' as const, evidence: '' },
                openQuestions: spec.openQuestions,
                keyTerms: spec.keyTerms,
                assignment: spec.assignment,
              },
            ]
          : [],
        studentPrompts: ep.signals.aiQuestions.map((text) => ({
          text,
          hasContext: CONTEXT.test(text),
          hasStructure: STRUCTURE.test(text),
          asksToBeQuizzed: QUIZ.test(text),
          asksForExamples: EXAMPLE.test(text),
        })),
      }
    }),
  })
}
