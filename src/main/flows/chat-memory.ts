/**
 * Chat memory for the double-tap chat: what the model gets as `history` each turn.
 *
 * The whole current chat is sent: every message since the last "New chat" (`since`), not just the
 * last few. Each assistant message carries what that turn did, so the model knows what it read,
 * created, changed or undid and can refer back to it ("it", "that course"):
 * - its tool calls and their results, compact ("Tool: create {…} → ok: {…}"), from a trace kept
 *   per turn (the chat itself never shows these);
 * - its receipts ("Done: …"), or "Undone by the student: …" once the student pressed Undo;
 * - its chips ("Waiting for the student's click: …").
 * A turn that failed without a reply still leaves its tool lines.
 *
 * Past a token budget the older part is folded into a short running summary (P16 via
 * Brain.summarizeChat; without it, or when it fails, a plain list of the older turns) and only
 * the recent turns stay verbatim. The summary is cached with the last message it covers, so it is
 * recomputed only when the verbatim part outgrows the budget again (it is folded to half the
 * budget each time), not every turn. "New chat" starts fresh: the cached summary covers messages
 * before it, so it no longer applies.
 *
 * Traces, undos and summaries live in side threads of the chat (`ask:trace`, `ask:summary`) as
 * small JSON records: no schema change, and the chat window never reads them.
 */

import { estimateTokens } from '@engine/brain/llm/text'
import { stableJson } from '@engine/brain/llm/tool-loop'
import type {
  CallOptions,
  ChatSummaryInput,
  ChatSummaryOutput,
  CoachInput,
} from '@engine/brain-contract'
import type { ChatRepo } from '@engine/contracts'
import { redactSecrets } from '@engine/privacy/redact'
import type { ChatMessage } from '@shared/domain'
import type { ChatTurnTools } from '../chat-tools'

/** History tokens before the older part is folded into the summary. */
export const MEMORY_BUDGET_TOKENS = 6000
/** Verbatim messages before folding, whatever their size (coachMessages caps at 120). */
const MAX_VERBATIM = 100
/** The most messages read back: far more than one chat holds between two "New chat"s. */
const READ_LIMIT = 1000
const SUMMARY_TIMEOUT_MS = 15_000
const CALL_INPUT_CHARS = 160
const CALL_RESULT_CHARS = 240
const MAX_TRACE_CALLS = 12
const FALLBACK_SUMMARY_CHARS = 3000

export type HistoryMessage = CoachInput['history'][number]

export interface ChatMemoryDeps {
  chat: Pick<ChatRepo, 'append' | 'history'>
  /** Brain.summarizeChat; without it the older part becomes a plain list of its turns. */
  summarize?: (input: ChatSummaryInput, opts?: CallOptions) => Promise<ChatSummaryOutput>
  /** The chat thread (AskFlow's ASK_THREAD). */
  thread?: string
  budgetTokens?: number
  log?: (line: string) => void
}

/** One turn's tools, wrapped so every call is recorded for the trace. */
export interface TracedTurn {
  tools: ChatTurnTools
  /** "Tool: name {input} → ok: {result}" per call, in order. */
  readonly lines: string[]
}

type Record_ =
  | { turn: string; calls: string[] }
  | { undone: string }
  | { upTo: string; summary: string }

interface Entry extends HistoryMessage {
  /** The message id (a failed turn's tool lines: the user message id + ":tools"). */
  id: string
  tokens: number
}

const short = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** A value as one short, redacted line (inputs and results of tool calls). */
function compact(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : stableJson(value ?? {})
  return short(redactSecrets(text).replace(/\s+/g, ' '), max)
}

function parse(message: ChatMessage): Record_ | null {
  try {
    const value = JSON.parse(message.content) as Record_
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** Messages created after `since` (epoch ms); all of them when there was no "New chat". */
function afterReset(messages: ChatMessage[], since: number | null): ChatMessage[] {
  if (since === null) return messages
  return messages.filter((m) => Date.parse(m.createdAt) > since)
}

/**
 * What an assistant message says in the history: its text, the turn's tool calls, what it did
 * ("Done: …", or "Undone by the student: …") and the chips waiting for a click.
 */
export function assistantText(message: ChatMessage, calls: string[], undone: Set<string>): string {
  const did = message.actions.flatMap((a) => {
    if (a.type === 'undo_save' && a.label) {
      return [
        a.saveId && undone.has(a.saveId) ? `Undone by the student: ${a.label}` : `Done: ${a.label}`,
      ]
    }
    if (a.type === 'run_tool') return [`Waiting for the student's click: ${a.label}`]
    return []
  })
  return [message.content, ...did, ...calls].filter(Boolean).join('\n')
}

const entry = (id: string, role: HistoryMessage['role'], content: string): Entry => ({
  id,
  role,
  content,
  tokens: estimateTokens(content) + 4,
})

const total = (entries: Entry[]) => entries.reduce((n, e) => n + e.tokens, 0)

/** The older turns as text for the summariser (and the plain-list fallback). */
function transcript(entries: Entry[]): string {
  return entries
    .map((e) => `${e.role === 'user' ? 'Student' : 'Dumbledore'}: ${e.content}`)
    .join('\n\n')
}

/** Without a summariser: the older turns as short lines, newest kept when it gets long. */
function plainSummary(previous: string, entries: Entry[]): string {
  const lines = entries.flatMap((e) => {
    const [first = '', ...rest] = e.content.split('\n')
    const who = e.role === 'user' ? 'Student' : 'Dumbledore'
    const did = rest.filter((l) => /^(Done|Undone by the student|Tool|Waiting for)/.test(l))
    return [`- ${who}: ${short(first, 160)}`, ...did.map((l) => `  ${short(l, 200)}`)]
  })
  const text = [previous.trim(), ...lines].filter(Boolean).join('\n')
  return text.length <= FALLBACK_SUMMARY_CHARS
    ? text
    : `[…]${text.slice(text.length - FALLBACK_SUMMARY_CHARS + 3)}`
}

/** The summary leads the first verbatim message (a user message) so roles keep alternating. */
function withSummary(summary: string, recent: Entry[]): HistoryMessage[] {
  const out: HistoryMessage[] = recent.map(({ role, content }) => ({ role, content }))
  if (!summary) return out
  const lead = `[Summary of the earlier part of this chat]\n${summary}\n[The chat continues]`
  const first = out[0]
  if (first?.role === 'user') out[0] = { role: 'user', content: `${lead}\n\n${first.content}` }
  else out.unshift({ role: 'user', content: lead })
  return out
}

export class ChatMemory {
  private readonly thread: string
  private readonly budget: number

  constructor(private readonly deps: ChatMemoryDeps) {
    this.thread = deps.thread ?? 'ask'
    this.budget = deps.budgetTokens ?? MEMORY_BUDGET_TOKENS
  }

  private get traceThread() {
    return `${this.thread}:trace`
  }

  private get summaryThread() {
    return `${this.thread}:summary`
  }

  /** Wraps a turn's tools so each call (name, input, result) is recorded for the next turns. */
  trace(turn: ChatTurnTools): TracedTurn {
    const lines: string[] = []
    const tools: ChatTurnTools = {
      ...turn,
      async run(name, input) {
        const out = await turn.run(name, input)
        lines.push(
          `Tool: ${name} ${compact(input, CALL_INPUT_CHARS)} → ${out.ok ? 'ok' : 'failed'}: ${compact(out.result, CALL_RESULT_CHARS)}`,
        )
        return out
      },
    }
    return { tools, lines }
  }

  /** Keeps a turn's tool calls with the student's message that started it. */
  saveTrace(userMessageId: string, traced: TracedTurn): void {
    if (!traced.lines.length) return
    const calls =
      traced.lines.length > MAX_TRACE_CALLS
        ? [
            ...traced.lines.slice(0, MAX_TRACE_CALLS),
            `Tool: … ${traced.lines.length - MAX_TRACE_CALLS} more calls`,
          ]
        : traced.lines
    this.record({ turn: userMessageId, calls })
  }

  /** Records a pressed Undo (when it worked), so the history says it was undone. Returns `ok`. */
  noteUndo(saveId: string, ok: boolean): boolean {
    if (ok && saveId) this.record({ undone: saveId })
    return ok
  }

  /**
   * The history for the next turn: the whole chat since `since` (epoch ms, null = no "New chat"),
   * with what each turn did; past the budget, the older part as the running summary.
   */
  async history(
    since: number | null,
    opts: { signal?: AbortSignal } = {},
  ): Promise<HistoryMessage[]> {
    const entries = this.entries(since)
    const cached = this.cachedSummary(entries)
    let summary = cached?.summary ?? ''
    let recent = cached ? entries.slice(cached.index + 1) : entries
    const fits = (list: Entry[]) =>
      estimateTokens(summary) + total(list) <= this.budget && list.length <= MAX_VERBATIM
    if (fits(recent)) return withSummary(summary, recent)

    const cut = this.foldPoint(recent)
    const older = recent.slice(0, cut)
    recent = recent.slice(cut)
    summary = await this.summarize(summary, older, opts.signal)
    const last = older.at(-1)
    if (last && !opts.signal?.aborted) this.record({ upTo: last.id, summary })
    return withSummary(summary, recent)
  }

  /** The chat since `since` as history entries, each turn with its tool lines and receipts. */
  private entries(since: number | null): Entry[] {
    const messages = afterReset(this.deps.chat.history(this.thread, READ_LIMIT), since)
    const calls = new Map<string, string[]>()
    const undone = new Set<string>()
    for (const m of this.deps.chat.history(this.traceThread, READ_LIMIT)) {
      const r = parse(m)
      if (r && 'turn' in r && Array.isArray(r.calls)) calls.set(r.turn, r.calls)
      else if (r && 'undone' in r) undone.add(r.undone)
    }
    const out: Entry[] = []
    // The tool lines of the latest student message, until a reply takes them.
    let pending: { id: string; calls: string[] } | null = null
    const flush = () => {
      if (pending) {
        const text = ['(No reply: the turn stopped.)', ...pending.calls].join('\n')
        out.push(entry(`${pending.id}:tools`, 'assistant', text))
      }
      pending = null
    }
    for (const m of messages) {
      if (m.role === 'user') {
        flush()
        out.push(entry(m.id, 'user', m.content))
        const own = calls.get(m.id)
        pending = own ? { id: m.id, calls: own } : null
      } else {
        const own: string[] = pending ? (pending as { calls: string[] }).calls : []
        pending = null
        out.push(entry(m.id, 'assistant', assistantText(m, own, undone)))
      }
    }
    flush()
    return out
  }

  /** The latest summary that still applies (it covers a message of this chat), and where. */
  private cachedSummary(entries: Entry[]): { summary: string; index: number } | null {
    const records = this.deps.chat.history(this.summaryThread, 20)
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i] ? parse(records[i] as ChatMessage) : null
      if (!r || !('upTo' in r) || typeof r.summary !== 'string') continue
      const index = entries.findIndex((e) => e.id === r.upTo)
      if (index >= 0) return { summary: r.summary, index }
    }
    return null
  }

  /**
   * Where the older part ends: the recent part keeps about half the budget (so the next fold is
   * many turns away), starts with a student message, and always keeps the last turn.
   */
  private foldPoint(list: Entry[]): number {
    const target = this.budget / 2
    let kept = 0
    let cut = list.length
    while (cut > 0) {
      const next = list[cut - 1] as Entry
      if (kept + next.tokens > target || list.length - cut >= MAX_VERBATIM / 2) break
      kept += next.tokens
      cut--
    }
    const lastUser = list.findLastIndex((e) => e.role === 'user')
    const nextUser = list.findIndex((e, i) => i >= cut && e.role === 'user')
    // Never fold the latest exchange away, even when it alone is over the target.
    if (nextUser >= 0) cut = nextUser
    else if (lastUser > 0) cut = lastUser
    return Math.max(1, Math.min(cut, list.length - 1))
  }

  private async summarize(previous: string, older: Entry[], signal?: AbortSignal): Promise<string> {
    const { summarize, log } = this.deps
    if (summarize) {
      try {
        const out = await summarize(
          { previous, transcript: transcript(older) },
          { signal, timeoutMs: SUMMARY_TIMEOUT_MS },
        )
        if (out.summary.trim()) return out.summary.trim()
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        log?.(`[chat-memory] summary failed, keeping a plain list: ${short(why, 200)}`)
      }
    }
    return plainSummary(previous, older)
  }

  private record(value: Record_): void {
    this.deps.chat.append({
      thread: value && 'upTo' in value ? this.summaryThread : this.traceThread,
      role: 'assistant',
      content: JSON.stringify(value),
      actions: [],
    })
  }
}
