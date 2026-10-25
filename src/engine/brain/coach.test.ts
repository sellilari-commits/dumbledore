import type { CoachEvent, CoachInput } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { BackendError } from './llm/types'
import { toCoachAction } from './prompts/p10-coach'
import { brainHarness, R } from './testing/harness'

const input = (message: string): CoachInput => ({
  profile: 'First-year chemistry student',
  context: 'Subjects: Organic Chemistry (id sub_1, mastery 62%, midterm 2026-12-12)',
  history: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'Hello — what are we studying?' },
  ],
  message,
})

async function collect(it: AsyncIterable<CoachEvent>): Promise<CoachEvent[]> {
  const out: CoachEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('Brain.coach', () => {
  it('streams text, then validated actions, then done', async () => {
    const h = brainHarness([R.groq, R.ovh])
    h.groq.queue({
      chunks: ["Let's ", 'build a roadmap.'],
      toolCalls: [
        { name: 'start_roadmap', input: { goal: 'the Calvin cycle', subjectId: null } },
        {
          name: 'create_exam',
          input: { subjectIds: ['sub_1'], count: 8, focus: 'weak', difficulty: 'mixed' },
        },
        { name: 'open_subject', input: { wrong: true } },
        { name: 'delete_everything', input: {} },
      ],
    })
    const events = await collect(h.brain.coach(input("I don't get the Calvin cycle")))
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e.type === 'text' ? e.delta : ''))
        .join(''),
    ).toBe("Let's build a roadmap.")
    const actions = events.flatMap((e) => (e.type === 'action' ? [e.action] : []))
    expect(actions).toEqual([
      { type: 'start_roadmap', goal: 'the Calvin cycle', subjectId: null, deadline: null },
      {
        type: 'create_exam',
        spec: { subjectIds: ['sub_1'], count: 10, focus: 'weak', difficulty: 'mixed' },
      },
    ])
    expect(events.at(-1)).toEqual({ type: 'done' })
    const req = h.groq.requests[0]
    expect(req?.tools?.map((t) => t.name)).toEqual([
      'start_roadmap',
      'create_exam',
      'start_review',
      'insert_prompt',
      'set_focus',
      'open_subject',
      'adjust_roadmap',
      'add_note',
      'save_question',
      'update_subject',
      'give_feedback',
    ])
    expect(req?.output).toEqual({ kind: 'text' })
    expect(req?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(req?.system).toContain('sub_1')
  })

  it('adds a short line when the model only calls a tool', async () => {
    const h = brainHarness()
    h.groq.queue({
      toolCalls: [{ name: 'start_roadmap', input: { goal: 'recursion', subjectId: null } }],
    })
    const events = await collect(h.brain.coach(input('teach me recursion')))
    expect(events[0]).toEqual({ type: 'text', delta: "Let's build a roadmap for that first." })
    expect(events[1]?.type).toBe('action')
  })

  it('asks again, without tools, for the answer when the model only saved', async () => {
    const h = brainHarness()
    h.groq.queue({
      toolCalls: [
        {
          name: 'save_question',
          input: {
            text: 'why are tertiary cations stable?',
            conceptId: null,
            topic: null,
            subjectId: null,
            stuck: true,
          },
        },
      ],
    })
    h.groq.queue({ text: 'Three alkyl groups share the charge.' })
    const events = await collect(h.brain.coach(input("I don't get carbocation stability")))
    expect(events[0]).toEqual({ type: 'text', delta: 'Three alkyl groups share the charge.' })
    expect(events[1]).toMatchObject({
      type: 'action',
      action: { type: 'save_question', stuck: true },
    })
  })

  it('falls through to the next chat model before the first token', async () => {
    const h = brainHarness([R.groq, R.ovh])
    h.groq.queue({ error: new BackendError('rate_limit', 'busy', { status: 429 }) })
    h.ovh.queue({ text: 'Focus on carbocations first.' })
    const events = await collect(h.brain.coach(input('what should I focus on?')))
    expect(events[0]).toEqual({ type: 'text', delta: 'Focus on carbocations first.' })
  })
})

describe('toCoachAction', () => {
  it('maps every tool and rejects bad input', () => {
    expect(toCoachAction('start_review', { conceptIds: ['con_1'] })).toEqual({
      type: 'start_review',
      conceptIds: ['con_1'],
    })
    expect(toCoachAction('insert_prompt', { text: 'I am…' })).toEqual({
      type: 'insert_prompt',
      text: 'I am…',
    })
    expect(toCoachAction('set_focus', { subjectId: '' })).toEqual({
      type: 'set_focus',
      subjectId: null,
    })
    expect(toCoachAction('open_subject', { subjectId: 'sub_9' })).toEqual({
      type: 'open_subject',
      subjectId: 'sub_9',
    })
    expect(
      toCoachAction('create_exam', { subjectIds: [], count: 5, focus: 'due', difficulty: 'easy' }),
    ).toBeNull()
    expect(
      toCoachAction('create_exam', {
        subjectIds: ['s'],
        count: 30,
        focus: 'due',
        difficulty: 'easy',
      }),
    ).toMatchObject({
      spec: { count: 20 },
    })
    expect(toCoachAction('nope', {})).toBeNull()
  })
})
