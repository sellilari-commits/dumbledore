/**
 * coach(): streams the P10 coach reply as CoachEvents — text deltas, then validated actions from
 * tool calls — and always finishes with `done`. Falls through to the next chat model only before
 * the first token arrives (the router's stream rule). A model that only saves (save_question,
 * update_subject, add_note, give_feedback) and says nothing — it expects to answer after the tool
 * result — is asked once more, without tools, for the answer itself. No canned lines: a model
 * that only acts says nothing, and the chat shows what it did as receipts.
 */
import type { CallOptions, CoachEvent, CoachInput } from '@engine/brain-contract'
import type { Clock } from '../clock'
import type { Router } from './llm/router'
import { deadlineFor } from './llm/structured'
import { estimateMessagesTokens, looksFinnish } from './llm/text'
import { COACH_TOOLS, coachMessages, coachSystem, toCoachAction } from './prompts/p10-coach'

/** Tool calls the student only sees as a receipt: the answer still has to come as text. */
const SAVES = new Set(['save_question', 'update_subject', 'add_note', 'give_feedback'])

const ANSWER_NOW =
  'You already saved what was needed; the student sees it. Now answer their message in text. Do not mention saving.'

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
      // Some models send an empty text part with a tool call: that is not an answer.
      if (part.delta.trim()) wroteText = true
      if (part.delta) yield { type: 'text', delta: part.delta }
    } else if (part.type === 'tool-call') {
      const action = toCoachAction(part.call.name, part.call.input)
      if (action) actions.push({ type: 'action', action })
    }
  }
  const onlySaved =
    actions.length > 0 && actions.every((a) => a.type === 'action' && SAVES.has(a.action.type))
  if (!wroteText && onlySaved) {
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
        system: `${system}\n\n${ANSWER_NOW}`,
        messages,
        output: { kind: 'text' },
        temperature: 0.6,
        maxOutputTokens,
        reasoningEffort: 'low',
        // Listed but not callable: a model told to act through tools, given none, answers with
        // an empty "malformed function call" (Gemini did); with tools it may not call, it answers.
        tools: COACH_TOOLS,
        toolChoice: 'none',
      },
    )) {
      if (part.type === 'text' && part.delta) {
        if (part.delta.trim()) wroteText = true
        yield { type: 'text', delta: part.delta }
      }
    }
  }
  for (const a of actions) yield a
  yield { type: 'done' }
}
