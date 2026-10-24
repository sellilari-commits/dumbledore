/**
 * coach(): streams the P10 coach reply as CoachEvents — text deltas, then validated actions from
 * tool calls — and always finishes with `done`. Falls through to the next chat model only before
 * the first token arrives (the router's stream rule).
 */
import type { CallOptions, CoachEvent, CoachInput } from '@engine/brain-contract'
import type { Clock } from '../clock'
import type { Router } from './llm/router'
import { deadlineFor } from './llm/structured'
import { estimateMessagesTokens, looksFinnish } from './llm/text'
import { COACH_TOOLS, coachMessages, coachSystem, toCoachAction } from './prompts/p10-coach'

const FALLBACK_TEXT: Record<string, string> = {
  start_roadmap: "Let's build a roadmap for that first.",
  create_exam: "I'll set up that exam.",
  start_review: "Let's do a quick review.",
  insert_prompt: "I've put a prompt in your chat box — read it, then send.",
  set_focus: 'Focus updated.',
  open_subject: 'Opening it now.',
}

export async function* runCoach(
  router: Router,
  clock: Clock,
  input: CoachInput,
  opts?: CallOptions,
): AsyncGenerator<CoachEvent> {
  const system = coachSystem(input)
  const messages = coachMessages(input)
  const maxOutputTokens = 1500
  let wroteText = false
  const actions: CoachEvent[] = []
  for await (const part of router.stream(
    {
      task: 'coach',
      tier: 'chat',
      deadline: deadlineFor('coach', clock, opts),
      signal: opts?.signal,
      estimatedTokens: estimateMessagesTokens(system, messages) + maxOutputTokens,
      outputTokens: maxOutputTokens,
      language: looksFinnish(input.message) ? 'fi' : 'en',
      onDeviceOk: false,
    },
    {
      system,
      messages,
      output: { kind: 'text' },
      temperature: 0.6,
      maxOutputTokens,
      reasoningEffort: 'low',
      tools: COACH_TOOLS,
    },
  )) {
    if (part.type === 'text') {
      wroteText = true
      yield { type: 'text', delta: part.delta }
    } else if (part.type === 'tool-call') {
      const action = toCoachAction(part.call.name, part.call.input)
      if (action) actions.push({ type: 'action', action })
    }
  }
  const first = actions[0]
  if (!wroteText && first?.type === 'action') {
    yield { type: 'text', delta: FALLBACK_TEXT[first.action.type] ?? '' }
  }
  for (const a of actions) yield a
  yield { type: 'done' }
}
