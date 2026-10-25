/**
 * runToolLoop(): a provider-neutral tool loop. One `step` is one streamed model call; when the
 * model calls tools, the loop runs them, feeds the calls and their results back and calls the
 * model again, until it answers in text — capped in steps and in time.
 *
 * Calls and results go back as plain ChatTurns, not native tool messages: an assistant turn that
 * lists the calls it made, then a user turn marked as tool results from the app (not the
 * student). That works on every provider and avoids Gemini 3's thought-signature requirement on
 * replayed function calls.
 *
 * Rules:
 * - The last allowed step runs without tools, so it has to answer.
 * - A call repeated with identical input is not run again: the earlier result goes back, and when
 *   a step only repeats earlier calls the next step is the last one (no tools).
 * - Each result is JSON, clipped to `clipChars`.
 * - Before any tool ran, an error, timeout or abort is thrown (like a single streamed call). Once
 *   a tool ran (writes may have happened), the loop never throws: an error or the deadline ends
 *   the turn with a short plain-language line so the caller can still show its receipts; an abort
 *   ends it quietly.
 * - Text streamed in any step is yielded; a blank line separates the text of different steps.
 */
import { BrainTimeoutError } from '@engine/brain-contract'
import type { Clock } from '../../clock'
import { abortError } from './router'
import type { ChatTurn, StreamPart, ToolDef } from './types'

export const TOOL_LOOP_DEFAULTS = {
  maxSteps: 6,
  timeoutMs: 75_000,
  /** Characters of one tool result (as JSON) that go back to the model. */
  clipChars: 3_000,
  /** Calls run per step; further calls in the same step are refused, not run. */
  maxCallsPerStep: 8,
} as const

export type ToolLoopStop =
  /** The model answered in text without calling tools. */
  | 'answered'
  /** The step cap was reached; the last step answered without tools. */
  | 'max-steps'
  /** The model repeated earlier calls; it was made to answer without tools. */
  | 'repeat'
  /** The overall deadline passed after tools had run. */
  | 'deadline'
  /** The caller aborted after tools had run. */
  | 'aborted'
  /** A step failed after tools had run. */
  | 'error'

export type ToolLoopEvent =
  | { type: 'text'; delta: string; step: number }
  | { type: 'tool-call'; name: string; input: unknown; step: number }
  | {
      type: 'tool-result'
      name: string
      input: unknown
      ok: boolean
      result: unknown
      /** Not run again: the same call with the same input ran earlier in this turn. */
      repeated: boolean
      step: number
    }
  | { type: 'done'; reason: ToolLoopStop; steps: number; toolCalls: number }

export interface ToolStepContext {
  /** 0-based step index. */
  step: number
  /** True on the step that runs without tools. */
  final: boolean
  /** Epoch ms (from the loop's clock) by which the whole loop must finish. */
  deadline: number
  /** Aborts on the caller's signal and on the deadline. */
  signal: AbortSignal
}

export interface ToolLoopOptions {
  /** The conversation so far; the last turn is the student's message. */
  messages: ChatTurn[]
  tools: ToolDef[]
  /** One model call. `tools` is undefined on the final step. */
  step(
    messages: ChatTurn[],
    tools: ToolDef[] | undefined,
    ctx: ToolStepContext,
  ): AsyncIterable<StreamPart>
  /** Runs one call. Should not throw; a throw counts as `{ ok: false }` with the message. */
  run(name: string, input: unknown): Promise<{ ok: boolean; result: unknown }>
  clock: Clock
  /** Default 6, at least 1. */
  maxSteps?: number
  /** Overall time for the loop, default 75 s. */
  timeoutMs?: number
  signal?: AbortSignal
  clipChars?: number
  maxCallsPerStep?: number
  /** Name in the BrainTimeoutError thrown when the deadline passes before any tool ran. */
  task?: string
  /** The lines the loop says itself (pass translations for the student's language). */
  lines?: Partial<ToolLoopLines>
}

export interface ToolLoopLines {
  /** A step failed or time ran out after tools had run. */
  cutShort: string
  /** The loop ended without any text from the model. */
  noAnswer: string
}

export const TOOL_LOOP_LINES_EN: ToolLoopLines = {
  cutShort:
    "Sorry, I couldn't finish that. Anything I already changed is listed below, with Undo. Ask me again to continue.",
  noAnswer: "Sorry, I couldn't put an answer together this time. Please ask again.",
}

/** Marks the user turn that carries tool results; the prompt tells the model what it means. */
export const TOOL_RESULTS_HEADER = '[tool results: from the app, not from the student]'
export const TOOL_CALLS_HEADER = '[tool calls]'

const CONTINUE =
  'Use these results. Call another tool only if you still need one; otherwise answer the student now.'
const ANSWER_NOW = 'No more tool calls are possible now. Answer the student now in plain text.'
const REPEATED_NOTE = 'You already made this exact call; this is its earlier result.'

/** JSON with object keys sorted, so equal inputs compare equal whatever their key order. */
export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    if (Array.isArray(v)) return v.map(norm)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) out[k] = norm((v as Record<string, unknown>)[k])
    return out
  }
  try {
    return JSON.stringify(norm(value)) ?? 'null'
  } catch {
    return String(value)
  }
}

/** A tool result as JSON, cut to `max` characters with a marker saying how much was cut. */
export function clipResult(result: unknown, max: number = TOOL_LOOP_DEFAULTS.clipChars): string {
  let json: string
  try {
    json = JSON.stringify(result) ?? 'null'
  } catch {
    json = stableJson(result)
  }
  if (json.length <= max) return json
  const cut = json.length - max
  return `${json.slice(0, max)}… [cut ${cut} more characters; read or search more narrowly if you need them]`
}

interface Call {
  name: string
  input: unknown
}

interface Ran extends Call {
  ok: boolean
  result: unknown
  repeated: boolean
}

/** The assistant turn that records what the model said and which tools it called. */
export function callsTurn(text: string, calls: Call[]): ChatTurn {
  const lines = calls.map((c) => `${c.name} ${stableJson(c.input ?? {})}`)
  const said = text.trim()
  return {
    role: 'assistant',
    content: [said, TOOL_CALLS_HEADER, ...lines].filter(Boolean).join('\n'),
  }
}

/** The user turn that carries the results of those calls back to the model. */
export function resultsTurn(ran: Ran[], clipChars: number, last: boolean): ChatTurn {
  const blocks = ran.map((r, i) => {
    const head = `${i + 1}. ${r.name} ${stableJson(r.input ?? {})} → ${r.ok ? 'ok' : 'failed'}`
    const note = r.repeated ? `\n${REPEATED_NOTE}` : ''
    return `${head}${note}\n${clipResult(r.result, clipChars)}`
  })
  return {
    role: 'user',
    content: [TOOL_RESULTS_HEADER, ...blocks, last ? ANSWER_NOW : CONTINUE].join('\n\n'),
  }
}

class Stopped extends Error {}

/** Iterates `source`, but stops (throws Stopped) as soon as `signal` aborts. */
async function* untilAborted<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iter = source[Symbol.asyncIterator]()
  let onAbort = () => {}
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Stopped())
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  stopped.catch(() => {})
  let finished = false
  try {
    for (;;) {
      const r = await Promise.race([iter.next(), stopped])
      if (r.done) {
        finished = true
        return
      }
      yield r.value
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (!finished) Promise.resolve(iter.return?.()).catch(() => {})
  }
}

export async function* runToolLoop(opts: ToolLoopOptions): AsyncGenerator<ToolLoopEvent> {
  const { clock } = opts
  const maxSteps = Math.max(1, Math.floor(opts.maxSteps ?? TOOL_LOOP_DEFAULTS.maxSteps))
  const clipChars = opts.clipChars ?? TOOL_LOOP_DEFAULTS.clipChars
  const maxCalls = opts.maxCallsPerStep ?? TOOL_LOOP_DEFAULTS.maxCallsPerStep
  const lines = { ...TOOL_LOOP_LINES_EN, ...opts.lines }
  const deadline = clock.now() + (opts.timeoutMs ?? TOOL_LOOP_DEFAULTS.timeoutMs)
  const task = opts.task ?? 'tool-loop'

  const control = new AbortController()
  const onCallerAbort = () => control.abort(opts.signal?.reason)
  if (opts.signal?.aborted) control.abort(opts.signal.reason)
  else opts.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const cancelTimer = clock.setTimeout(
    () => control.abort(new BrainTimeoutError(task)),
    Math.max(1, deadline - clock.now()),
  )

  const messages = [...opts.messages]
  const done = new Map<string, Ran>()
  let toolCalls = 0
  let wroteText = false
  let steps = 0
  let forceFinal = false
  let reason: ToolLoopStop = 'answered'

  const callerAborted = () => opts.signal?.aborted === true
  const timedOut = () =>
    clock.now() >= deadline || control.signal.reason instanceof BrainTimeoutError

  try {
    for (let step = 0; ; step++) {
      if (callerAborted()) throw abortError()
      if (timedOut()) throw new BrainTimeoutError(task)
      const final = forceFinal || step >= maxSteps - 1
      steps = step + 1
      let text = ''
      const calls: Call[] = []
      for await (const part of untilAborted(
        opts.step(messages, final ? undefined : opts.tools, {
          step,
          final,
          deadline,
          signal: control.signal,
        }),
        control.signal,
      )) {
        if (part.type === 'text') {
          if (!part.delta) continue
          const sep = text === '' && wroteText ? '\n\n' : ''
          text += part.delta
          wroteText = true
          yield { type: 'text', delta: sep + part.delta, step }
        } else if (part.type === 'tool-call' && !final) {
          calls.push(part.call)
        }
      }
      if (final) {
        if (forceFinal) reason = 'repeat'
        else if (step > 0 && step >= maxSteps - 1) reason = 'max-steps'
        break
      }
      if (calls.length === 0) break

      const ran: Ran[] = []
      for (const [i, call] of calls.entries()) {
        if (callerAborted()) throw abortError()
        yield { type: 'tool-call', name: call.name, input: call.input, step }
        const key = `${call.name} ${stableJson(call.input ?? {})}`
        const earlier = done.get(key)
        let r: Ran
        if (earlier) {
          r = { ...earlier, repeated: true }
        } else if (i >= maxCalls) {
          r = {
            ...call,
            ok: false,
            result: { error: `Not run: at most ${maxCalls} calls per step.` },
            repeated: false,
          }
        } else {
          toolCalls++
          let out: { ok: boolean; result: unknown }
          try {
            out = await opts.run(call.name, call.input)
          } catch (err) {
            out = { ok: false, result: { error: err instanceof Error ? err.message : String(err) } }
          }
          r = { ...call, ok: out.ok, result: out.result, repeated: false }
          done.set(key, r)
        }
        ran.push(r)
        yield { type: 'tool-result', ...r, step }
      }
      if (ran.every((r) => r.repeated)) forceFinal = true
      const nextIsFinal = forceFinal || step + 1 >= maxSteps - 1
      messages.push(callsTurn(text, calls), resultsTurn(ran, clipChars, nextIsFinal))
    }
    if (!wroteText) yield { type: 'text', delta: lines.noAnswer, step: steps - 1 }
    yield { type: 'done', reason, steps, toolCalls }
  } catch (err) {
    // Nothing ran yet: behave like one streamed call and let the caller handle the error.
    if (toolCalls === 0) {
      if (callerAborted()) throw abortError()
      if (err instanceof Stopped || timedOut()) throw new BrainTimeoutError(task)
      throw err
    }
    // Tools ran (maybe writes): keep the turn so the caller can show its receipts.
    if (callerAborted()) {
      yield { type: 'done', reason: 'aborted', steps, toolCalls }
      return
    }
    const sep = wroteText ? '\n\n' : ''
    yield { type: 'text', delta: sep + lines.cutShort, step: Math.max(0, steps - 1) }
    yield { type: 'done', reason: timedOut() ? 'deadline' : 'error', steps, toolCalls }
  } finally {
    cancelTimer()
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }
}
