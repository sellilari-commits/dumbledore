/**
 * runCoachLoop(): P10 in chat mode with tools (Brain.coachLoop). Runs the chat-tools prompt
 * through llm/tool-loop.ts on the router's `coach` chat route: each step is one router.stream()
 * call (text output, the shell's tools as ToolDefs, the loop's overall deadline), so a step falls
 * through to the next chat model only before its first part arrives. Yields text deltas, one
 * 'tool' event per call that ran, then 'done'. No chips or actions: the shell turns its own tool
 * outcomes into receipts and chips. The last step lists the tools with toolChoice 'none' (as
 * coach.ts does since d162b54): with no declarations at all, Gemini tries a call it cannot make
 * and returns no text.
 */
import type { CoachEvent, CoachInput, CoachLoopOptions, CoachTools } from '@engine/brain-contract'
import type { Clock } from '../clock'
import type { Router } from './llm/router'
import { estimateMessagesTokens, estimateTokens, looksFinnish } from './llm/text'
import { runToolLoop, TOOL_LOOP_DEFAULTS, type ToolLoopLines } from './llm/tool-loop'
import type { ToolDef } from './llm/types'
import { chatToolsSystem } from './prompts/p10-chat-tools'
import { coachMessages } from './prompts/p10-coach'

/** The whole turn, all steps together, when the caller passes no `timeoutMs`. */
export const COACH_LOOP_TIMEOUT_MS = TOOL_LOOP_DEFAULTS.timeoutMs

const LINES_FI: ToolLoopLines = {
  cutShort:
    'Anteeksi, en saanut tätä valmiiksi. Jo tekemäni muutokset näkyvät alla, ja ne voi perua. Kysy uudestaan, niin jatketaan.',
  noAnswer: 'Anteeksi, en saanut vastausta kokoon tällä kertaa. Kysy uudestaan.',
}

export async function* runCoachLoop(
  router: Router,
  clock: Clock,
  input: CoachInput,
  tools: CoachTools,
  opts?: CoachLoopOptions,
): AsyncGenerator<CoachEvent> {
  const system = chatToolsSystem(input)
  const toolDefs: ToolDef[] = tools.specs.map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  }))
  const toolTokens = estimateTokens(JSON.stringify(toolDefs))
  const maxOutputTokens = 1500
  const finnish = looksFinnish(input.message)

  const loop = runToolLoop({
    messages: coachMessages(input),
    tools: toolDefs,
    clock,
    maxSteps: opts?.maxSteps,
    timeoutMs: opts?.timeoutMs ?? COACH_LOOP_TIMEOUT_MS,
    signal: opts?.signal,
    task: 'coach',
    lines: finnish ? LINES_FI : undefined,
    run: (name, call) => tools.run(name, call),
    step: (messages, stepTools, ctx) =>
      router.stream(
        {
          task: 'coach',
          tier: 'chat',
          deadline: ctx.deadline,
          signal: ctx.signal,
          estimatedTokens: estimateMessagesTokens(system, messages) + toolTokens + maxOutputTokens,
          outputTokens: maxOutputTokens,
          language: finnish ? 'fi' : 'en',
          onDeviceOk: false,
        },
        {
          system,
          messages,
          output: { kind: 'text' },
          temperature: 0.5,
          maxOutputTokens,
          reasoningEffort: 'low',
          // The final step: listed but not callable, so the model answers in text.
          tools: stepTools ?? toolDefs,
          toolChoice: stepTools ? 'auto' : 'none',
        },
      ),
  })

  for await (const e of loop) {
    if (e.type === 'text') yield { type: 'text', delta: e.delta }
    else if (e.type === 'tool-result' && !e.repeated)
      yield { type: 'tool', name: e.name, input: e.input, ok: e.ok }
    else if (e.type === 'done') yield { type: 'done' }
  }
}
