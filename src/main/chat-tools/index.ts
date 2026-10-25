/**
 * The chat tools registry: everything the double-tap chat's model can call, in one place.
 * createChatTools() builds read, search, create, update, delete and act (plus web_search when it
 * is wired), gives their JSON schemas to the model (`specs`) and runs a call by name: the input is
 * validated with the tool's zod schema, every call is logged (name, ok, a short redacted input),
 * and a throwing tool becomes a failure the model can read.
 *
 * `turn()` is one chat turn: the CoachTools that brain.coachLoop calls, plus what the turn did —
 * receipts (each write's line with its Undo) and chips (a delete waiting for its button, an
 * offered flow). `actions()` turns them into what the reply carries: the chips as they are, then
 * one labelled undo_save per receipt ({ saveId: the Undo id, label: the line }); a receipt that
 * has no Undo is an undo_save with an empty saveId, shown as a line without an Undo button.
 */
import { toProviderSchema } from '@engine/brain/llm/json'
import { stableJson } from '@engine/brain/llm/tool-loop'
import type { CoachToolSpec, CoachTools, WebSearchSource } from '@engine/brain-contract'
import type { MemoryControl, QueryService, Repos, StudyService } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { redactSecrets } from '@engine/privacy/redact'
import type { CoachAction } from '@shared/domain'
import type { z } from 'zod'
import { type ActFlow, type ActToolDeps, createActTool } from './act'
import { createReadTools } from './read'
import {
  type ChatTool,
  failure,
  type Receipt,
  short,
  type ToolCtx,
  type ToolOutcome,
} from './types'
import type { UndoLog } from './undo'
import type { WebSearchTool } from './web-search'
import { createWriteTools, type WriteToolsDeps } from './write'

export interface ChatToolsDeps {
  repos: Repos
  queries: Pick<QueryService, 'subjects'>
  memory: Pick<MemoryControl, 'tree' | 'looseNotes'>
  study?: Pick<StudyService, 'current'>
  bus: Pick<EngineBus, 'emit'>
  undo: UndoLog
  relink: WriteToolsDeps['relink']
  nowIso: () => string
  /** Coach flows run by act (ChatSaves, background planning, RoadmapAdjust…). */
  perform: ActToolDeps['perform']
  /** Acts the shell adds by name (write_prompt, open_topic, restore_roadmap_version…). */
  flows?: ActFlow[]
  /** IPC channels classified 'act'; absent = no app acts. */
  invoke?: ActToolDeps['invoke']
  /** web_search (createWebSearchTool); absent = no web search. Reset at every turn. */
  webSearch?: Pick<WebSearchTool, 'tool' | 'resetTurn' | 'turnSources'> | null
  log?: (line: string) => void
}

export interface ChatTurnTools extends CoachTools {
  /** What the turn's writes and acts did, in order. */
  readonly receipts: Receipt[]
  /** Chips the turn's calls asked for (a delete to confirm, an offered flow). */
  readonly chips: CoachAction[]
  /** Every call that ran: name and whether it succeeded. */
  readonly calls: { name: string; ok: boolean }[]
  /** Sources this turn's web searches returned (empty when none ran). */
  sources(): WebSearchSource[]
  /** The reply's actions: chips, then one labelled undo_save per receipt. */
  actions(): CoachAction[]
}

export interface ChatTools {
  tools: ChatTool[]
  specs: CoachToolSpec[]
  /** Runs one call by name: validated, logged, never throws. */
  run(name: string, input: unknown, ctx?: ToolCtx): Promise<ToolOutcome>
  /** One chat turn's tools; `ctx` goes to every call of the turn. */
  turn(ctx?: ToolCtx): ChatTurnTools
}

/** A receipt as the reply carries it: a labelled undo_save ('' = no Undo, the line only). */
export function receiptAction(receipt: Receipt): CoachAction {
  return { type: 'undo_save', saveId: receipt.undoId ?? '', label: receipt.line }
}

/** "a short, redacted picture of the input" for the log: never a key or a token. */
export function logInput(input: unknown, max = 120): string {
  let text: string
  try {
    text = stableJson(input ?? {})
  } catch {
    text = String(input)
  }
  return short(redactSecrets(text), max)
}

function issues(error: z.ZodError): string {
  return short(
    error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; '),
    300,
  )
}

const chipKey = (chip: CoachAction) => stableJson(chip)

export function createChatTools(deps: ChatToolsDeps): ChatTools {
  const log = (line: string) => deps.log?.(`[chat-tools] ${line}`)
  const tools: ChatTool[] = [
    ...createReadTools({
      repos: deps.repos,
      queries: deps.queries,
      memory: deps.memory,
      study: deps.study,
      nowIso: deps.nowIso,
    }),
    ...createWriteTools({
      repos: deps.repos,
      bus: deps.bus,
      undo: deps.undo,
      relink: deps.relink,
      nowIso: deps.nowIso,
    }),
    createActTool({
      perform: deps.perform,
      flows: deps.flows,
      invoke: deps.invoke,
      log: (line) => log(line),
    }) as ChatTool,
    ...(deps.webSearch ? [deps.webSearch.tool as ChatTool] : []),
  ]
  const byName = new Map(tools.map((t) => [t.name, t]))
  const specs: CoachToolSpec[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toProviderSchema(t.input) as Record<string, unknown>,
  }))

  async function run(name: string, input: unknown, ctx: ToolCtx = {}): Promise<ToolOutcome> {
    const tool = byName.get(name)
    let out: ToolOutcome
    if (!tool) {
      out = failure(`Unknown tool "${short(name, 40)}". Tools: ${[...byName.keys()].join(', ')}.`)
    } else {
      const parsed = tool.input.safeParse(input ?? {})
      if (!parsed.success) {
        out = failure(`Bad input for ${name}: ${issues(parsed.error)}`)
      } else {
        try {
          out = await tool.run(parsed.data, ctx)
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          out = failure(`${name} failed: ${short(why, 200)}`)
        }
      }
    }
    log(`${name} ${out.ok ? 'ok' : 'failed'} ${logInput(input)}`)
    return out
  }

  function turn(ctx: ToolCtx = {}): ChatTurnTools {
    const receipts: Receipt[] = []
    const chips: CoachAction[] = []
    const calls: { name: string; ok: boolean }[] = []
    deps.webSearch?.resetTurn()
    return {
      specs,
      receipts,
      chips,
      calls,
      sources: () => deps.webSearch?.turnSources() ?? [],
      async run(name, input) {
        const out = await run(name, input, ctx)
        calls.push({ name, ok: out.ok })
        receipts.push(...out.receipts)
        const seen = new Set(chips.map(chipKey))
        for (const chip of out.chips) if (!seen.has(chipKey(chip))) chips.push(chip)
        return { ok: out.ok, result: out.result }
      },
      actions: () => [...chips, ...receipts.map(receiptAction)],
    }
  }

  return { tools, specs, run, turn }
}
