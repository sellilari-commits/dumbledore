/**
 * The `act` chat tool: flows that are more than a row edit, by name.
 * - Coach flows: the CoachAction types the chat may run (start or adjust a roadmap, create an
 *   exam, start a review, set the focus, open a subject, save a question or a note). The action
 *   is `{ type: name, ...args }`, validated with CoachAction and run by the chat flow
 *   (deps.perform), which knows receipts, Undo and background planning.
 * - App acts: the IPC channels classified 'act' in IPC_TOOL_CLASS, validated with the channel's
 *   own request schema and run through deps.invoke. They have no Undo.
 * - Chat flows: acts the shell adds by name with their own zod schema (deps.flows), e.g. write a
 *   prompt and paste it into the AI chat, open a topic, bring back an earlier roadmap version.
 * `offer: true` runs nothing: the coach flow comes back as a chip the student can press (a chat
 * flow as a run_tool chip that runs this act). App acts cannot be chips, so offering one is
 * refused.
 * Providers run strict JSON schemas, so `args` is a JSON-object string (an object is accepted too).
 */
import { CoachAction } from '@shared/domain'
import { type InvokeChannel, type InvokeRes, ipcInvoke } from '@shared/ipc'
import { z } from 'zod'
import type { InvokeReqOut } from '../ipc/types'
import {
  type ChatTool,
  defineTool,
  failure,
  outcome,
  short,
  type ToolCtx,
  type ToolOutcome,
} from './types'

/** An act the shell adds by name (not a CoachAction): its own args schema and runner. */
export interface ActFlow {
  name: string
  /** One line for the act tool's description: what it does and when to use it. */
  description: string
  // biome-ignore lint/suspicious/noExplicitAny: any object schema; args are parsed with it
  input: z.ZodObject<any>
  /** The chip label when the flow is offered ("Open ChatGPT and paste"). */
  label(args: Record<string, unknown>): string
  run(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolOutcome> | ToolOutcome
}

export interface ActToolDeps {
  /** Runs a coach flow the way the chat does (ChatSaves receipts, background planning…). */
  perform(action: CoachAction, ctx: ToolCtx): Promise<ToolOutcome>
  /** Chat flows by name (write_prompt, open_topic, restore_roadmap_version…). */
  flows?: ActFlow[]
  /**
   * Why a coach flow must not run or be offered (e.g. a second roadmap for a subject that has
   * one); null = fine. Checked before an offer too, so no chip offers what would be refused.
   */
  refuse?(action: CoachAction): string | null
  /** Calls an IPC channel's handler with the parsed request (runHandler); absent = no app acts. */
  invoke?(channel: InvokeChannel, payload: unknown): Promise<unknown>
  log?(message: string): void
}

// ─── IPC classification ─────────────────────────────────────────────────────────────────────

/**
 * - act: callable through `act` by name
 * - read: covered by the read/search tools
 * - write: row edits, covered by create/update/delete (they need snapshot Undo)
 * - deny: never from the chat
 */
export type IpcToolClass = 'act' | 'read' | 'write' | 'deny'

/** Every IPC channel, classified; the compiler refuses a new channel until it has a class here. */
export const IPC_TOOL_CLASS: Record<InvokeChannel, IpcToolClass> = {
  // Read models and current state: the read tool's sources.
  'app.getState': 'read',
  'settings.get': 'read',
  'profile.get': 'read',
  'providers.usage': 'read',
  'home.get': 'read',
  'subjects.list': 'read',
  'subjects.get': 'read',
  'inbox.list': 'read',
  'exams.list': 'read',
  'search.query': 'read',
  'subjects.tree': 'read',
  'notes.loose': 'read',
  'session.get': 'read',
  'session.picker': 'read',
  'quiz.get': 'read',
  'chat.history': 'read',

  // Row edits: create/update/delete snapshot them first so each has an Undo.
  'profile.update': 'write',
  'subjects.create': 'write',
  'subjects.update': 'write',
  'assignments.add': 'write',
  'notes.update': 'write',
  'notes.delete': 'write',
  'notes.file': 'write',
  'concepts.update': 'write',
  'concepts.delete': 'write',
  'encounters.delete': 'write',
  // Roadmap versions: history is read through `read`; a restore runs as its own act with Undo.
  'roadmaps.history': 'read',
  'roadmaps.restore': 'deny',

  // Acts: small, local, what the student would do with one click in the app.
  // Study session: start, step on, stop (start_roadmap plans a new roadmap in the background).
  'session.start': 'act',
  'session.next': 'act',
  'session.end': 'act',
  // Open a page of the app.
  'window.open': 'act',
  // Sorting what capture found: a suggested subject or an inbox item, as on the Inbox page.
  'suggested.act': 'act',
  'inbox.act': 'act',

  // Secrets, provider and key tests, settings (capture switches, privacy blocklists), permissions,
  // relaunch: the student's own setup, never changed by a chat. The focus subject is set_focus.
  'secrets.set': 'deny',
  'providers.test': 'deny',
  'settings.update': 'deny',
  'capture.setEnabled': 'deny',
  'permissions.status': 'deny',
  'permissions.open': 'deny',
  'permissions.reset': 'deny',
  'app.relaunch': 'deny',
  // Export and destructive bulk operations.
  'data.export': 'deny',
  'data.deleteAll': 'deny',
  'subjects.delete': 'deny',
  // File pickers and external files: need the student at a dialog, or write files outside the app.
  'materials.add': 'deny',
  'concepts.openText': 'deny',
  // Window plumbing and the overlay belong to the shell.
  'window.close': 'deny',
  'window.setSize': 'deny',
  'overlay.getState': 'deny',
  'overlay.action': 'deny',
  // Recursion: the chat itself, the ask bar and coach actions (coach flows are act's own names).
  'chat.send': 'deny',
  'ask.submit': 'deny',
  'coach.runAction': 'deny',
  'nudge.act': 'deny',
  // Pasting into the student's AI chat or clipboard is not for the chat.
  'prompt.copy': 'deny',
  'prompt.sendToChat': 'deny',
  // Opens a website: only ever from the student's click on "Open <AI> and paste".
  'prompt.openUsualAi': 'deny',
  'prompt.write': 'deny',
  // The student's own answers.
  'quiz.answer': 'deny',
  'quiz.finish': 'deny',
  // The create_exam coach flow creates the exam and opens it; one name per flow.
  'exams.create': 'deny',
}

export const ACT_CHANNELS = (Object.keys(IPC_TOOL_CLASS) as InvokeChannel[]).filter(
  (channel) => IPC_TOOL_CLASS[channel] === 'act',
)

// ─── Coach flows ────────────────────────────────────────────────────────────────────────────

type CoachType = CoachAction['type']

/** The coach flows `act` runs, with what each is for (fields come from the CoachAction schema). */
const COACH_FLOWS = {
  start_roadmap:
    'plan a new roadmap for a subject (null = a new subject from the goal); it plans in the background and the chat says when it is ready',
  adjust_roadmap: "replan a subject's roadmap from the student's own words",
  create_exam: 'create a practice exam and open it in the app',
  start_review: 'start a review quiz on topics (concept ids) in the overlay',
  set_focus: 'set the focus subject (null clears it)',
  open_subject: "open a subject's page in the app",
  save_question:
    'save something the student asked or does not get as an open question (null ids = current topic); stuck also marks a gap',
  add_note: 'save a note the student typed (null ids = the current topic)',
} satisfies Partial<Record<CoachType, string>>

export type ActCoachFlow = keyof typeof COACH_FLOWS
export const COACH_FLOW_NAMES = Object.keys(COACH_FLOWS) as ActCoachFlow[]

/** Coach actions act does not run, and where the model should go instead. */
const NOT_COACH_FLOWS: Partial<Record<CoachType, string>> = {
  give_feedback: "use create with kind 'feedback'",
  update_subject: "use update with kind 'subject'",
}

const coachOption = (type: CoachType) =>
  CoachAction.options.find((option) => option.shape.type.value === type)

// ─── Schema descriptions ────────────────────────────────────────────────────────────────────

interface LooseDef {
  type: string
  innerType?: z.ZodType
  element?: z.ZodType
  shape?: Record<string, z.ZodType>
  entries?: Record<string, unknown>
  values?: unknown[]
  options?: z.ZodType[]
  in?: z.ZodType
}

const defOf = (schema: z.ZodType) => schema._zod.def as unknown as LooseDef

/** A compact TypeScript-like picture of a schema: `{subjectId: string|null, goal: string}`. */
export function describeSchema(schema: z.ZodType, skip: string[] = []): string {
  const def = defOf(schema)
  switch (def.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return def.type
    case 'void':
    case 'undefined':
      return '{}'
    case 'nullable':
      return def.innerType ? `${describeSchema(def.innerType)}|null` : 'null'
    case 'optional':
    case 'default':
    case 'readonly':
      return def.innerType ? describeSchema(def.innerType) : 'any'
    case 'pipe':
      return def.in ? describeSchema(def.in) : 'any'
    case 'array':
      return def.element ? `${describeSchema(def.element)}[]` : 'any[]'
    case 'enum':
      return Object.values(def.entries ?? {})
        .map((v) => JSON.stringify(v))
        .join('|')
    case 'literal':
      return (def.values ?? []).map((v) => JSON.stringify(v)).join('|')
    case 'union':
      return (def.options ?? []).map((o) => describeSchema(o)).join('|')
    case 'object': {
      const fields = Object.entries(def.shape ?? {})
        .filter(([key]) => !skip.includes(key))
        .map(([key, field]) => {
          const optional = defOf(field).type === 'optional' ? '?' : ''
          return `${key}${optional}: ${describeSchema(field)}`
        })
      return `{${fields.join(', ')}}`
    }
    default:
      return 'any'
  }
}

/** Args may leave out nullable fields: they count as null (top level only). */
function fillNulls(schema: z.ZodType, args: Record<string, unknown>): Record<string, unknown> {
  const def = defOf(schema)
  if (def.type !== 'object' || !def.shape) return args
  const filled = { ...args }
  for (const [key, field] of Object.entries(def.shape)) {
    if (!(key in filled) && defOf(field).type === 'nullable') filled[key] = null
  }
  return filled
}

// ─── Running ────────────────────────────────────────────────────────────────────────────────

type ParsedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }

/** Lenient: empty = {}, code fences stripped, a JSON string inside a string unwrapped. */
export function parseArgs(raw: unknown): ParsedArgs {
  let value: unknown = raw
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth++) {
    const text = value
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    if (text === '') return { ok: true, args: {} }
    try {
      value = JSON.parse(text)
    } catch {
      return { ok: false, error: `args is not valid JSON: ${short(text, 80)}` }
    }
  }
  if (value === null || value === undefined) return { ok: true, args: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'args must be a JSON object, e.g. {"subjectId": "…"}' }
  }
  return { ok: true, args: value as Record<string, unknown> }
}

function issues(error: z.ZodError): string {
  const lines = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
  return short(lines.join('; '), 300)
}

type ReceiptFns = { [C in InvokeChannel]?: (req: InvokeReqOut<C>, res: InvokeRes<C>) => string }

const SURFACE_NAMES = { app: 'Dumbledore', panel: 'the study panel', askbar: 'the Ask bar' }

function pageName(route: string): string {
  const [page, id, view] = route.split('/').filter(Boolean)
  if (page === 'exams' && id) return 'the exam'
  if (page === 'subjects' && id) return view ? `the subject's ${view}` : 'the subject'
  if (!page) return 'Dumbledore'
  return page.charAt(0).toUpperCase() + page.slice(1)
}

const DONE = {
  accept: 'Accepted',
  dismiss: 'Dismissed',
  merge: 'Merged',
  ignore: 'Ignored',
  assign: 'Filed',
}

const RECEIPTS: ReceiptFns = {
  'session.start': () => 'Study session started',
  'session.next': (_req, res) => (res ? 'Next study step' : 'Study session finished'),
  'session.end': () => 'Study session ended',
  'window.open': ({ surface, route }) =>
    `Opened ${route ? pageName(route) : SURFACE_NAMES[surface]}`,
  'suggested.act': ({ action }) => `${DONE[action]} suggested subject`,
  'inbox.act': ({ action }) => `${DONE[action]} inbox item`,
}

function receiptFor(channel: InvokeChannel, req: unknown, res: unknown): string {
  const fn = RECEIPTS[channel] as ((req: unknown, res: unknown) => string) | undefined
  return fn ? fn(req, res) : `Done: ${channel}`
}

/** What the IPC acts are for, shown with their args. */
const ACT_NOTES: Partial<Record<InvokeChannel, string>> = {
  'session.start':
    "start or resume a study session on a subject's roadmap (to plan a new roadmap use start_roadmap)",
  'session.next': 'move the running study session to its next step',
  'session.end': 'end the running study session',
  'window.open':
    "open a page: surface 'app' with route /home, /inbox, /exams, /exams/<quizId>, /subjects/<id>/<roadmap|concepts|seen|exams>, /settings/<section>",
  'suggested.act': 'accept, dismiss or merge (into intoId) a subject that capture suggested',
  'inbox.act': 'accept, ignore or assign (to subjectId) an inbox item',
}

function describeTool(flows: readonly ActFlow[]): string {
  const coach = COACH_FLOW_NAMES.map((name) => {
    const option = coachOption(name)
    const fields = option ? describeSchema(option, ['type']) : '{}'
    return `- ${name} ${fields}: ${COACH_FLOWS[name]}`
  })
  const acts = ACT_CHANNELS.map(
    (channel) =>
      `- ${channel} ${describeSchema(ipcInvoke[channel].req)}: ${ACT_NOTES[channel] ?? ''}`,
  )
  const chat = flows.map(
    (flow) => `- ${flow.name} ${describeSchema(flow.input)}: ${flow.description}`,
  )
  return [
    'Run a flow that is more than a row edit, by name. args is a JSON object string with the fields shown (null for "none"); ids only from what read/search returned.',
    'offer: true runs nothing and shows the coach flow as a button the student can press; use it when the student should decide. offer: false runs it now.',
    'Coach flows (can be offered):',
    ...coach,
    ...chat,
    'App actions (run only, never offered; no Undo):',
    ...acts,
    'Row edits are create/update/delete; reading is read/search.',
  ].join('\n')
}

const Input = z.object({
  name: z.string(),
  args: z.preprocess(
    (value) => (value && typeof value === 'object' ? JSON.stringify(value) : (value ?? '')),
    z.string(),
  ),
  offer: z.boolean(),
})

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createActTool(deps: ActToolDeps): ChatTool<z.output<typeof Input>> {
  const log = (message: string) => deps.log?.(`act: ${message}`)
  const flows = deps.flows ?? []
  const validNames = () =>
    [...COACH_FLOW_NAMES, ...flows.map((f) => f.name), ...ACT_CHANNELS].join(', ')

  async function runFlow(
    flow: ActFlow,
    args: Record<string, unknown>,
    offer: boolean,
    ctx: ToolCtx,
  ) {
    const parsed = flow.input.safeParse(fillNulls(flow.input, args))
    if (!parsed.success) {
      log(`${flow.name} bad args: ${issues(parsed.error)}`)
      return failure(`Bad args for ${flow.name}: ${issues(parsed.error)}`)
    }
    const data = parsed.data as Record<string, unknown>
    if (offer) {
      log(`${flow.name} offered`)
      const chip: CoachAction = {
        type: 'run_tool',
        tool: 'act',
        input: { name: flow.name, args: JSON.stringify(data), offer: false },
        label: flow.label(data),
      }
      return outcome(
        {
          offered: flow.name,
          note: 'Shown as a button; nothing runs until the student presses it.',
        },
        { chips: [chip] },
      )
    }
    try {
      const result = await flow.run(data, ctx)
      log(`${flow.name} ${result.ok ? 'ran' : 'failed'}`)
      return result
    } catch (error) {
      log(`${flow.name} failed: ${errorText(error)}`)
      return failure(`${flow.name} failed: ${short(errorText(error), 200)}`)
    }
  }

  async function runCoach(
    name: ActCoachFlow,
    args: Record<string, unknown>,
    offer: boolean,
    ctx: ToolCtx,
  ) {
    const option = coachOption(name)
    const candidate = { ...(option ? fillNulls(option, args) : args), type: name }
    const parsed = CoachAction.safeParse(candidate)
    if (!parsed.success) {
      log(`${name} bad args: ${issues(parsed.error)}`)
      return failure(`Bad args for ${name}: ${issues(parsed.error)}`)
    }
    const action = parsed.data
    const refused = deps.refuse?.(action) ?? null
    if (refused) {
      log(`${name} refused: ${short(refused, 80)}`)
      return failure(refused)
    }
    if (offer) {
      log(`${name} offered`)
      return outcome(
        { offered: name, note: 'Shown as a button; nothing runs until the student presses it.' },
        { chips: [action] },
      )
    }
    try {
      const result = await deps.perform(action, ctx)
      log(`${name} ${result.ok ? 'ran' : 'failed'}`)
      return result
    } catch (error) {
      log(`${name} failed: ${errorText(error)}`)
      return failure(`${name} failed: ${short(errorText(error), 200)}`)
    }
  }

  async function runIpc(channel: InvokeChannel, args: Record<string, unknown>, offer: boolean) {
    if (offer) {
      return failure(
        `${channel} is an app action and cannot be offered as a button; run it (offer: false) or offer a coach flow.`,
      )
    }
    if (!deps.invoke) return failure('App actions are not available here.')
    const schema = ipcInvoke[channel].req as z.ZodType
    const kind = defOf(schema).type
    const payload =
      kind === 'void'
        ? undefined
        : kind === 'object'
          ? fillNulls(schema, args)
          : (args.value ?? Object.values(args)[0])
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      log(`${channel} bad args: ${issues(parsed.error)}`)
      return failure(`Bad args for ${channel}: ${issues(parsed.error)}`)
    }
    try {
      const res = await deps.invoke(channel, parsed.data)
      const line = receiptFor(channel, parsed.data, res)
      log(`${channel} ran: ${line}`)
      return outcome(
        { done: line, ...(res === undefined ? {} : { result: res }), undo: 'This has no Undo.' },
        { receipts: [{ line, undoId: null }] },
      )
    } catch (error) {
      log(`${channel} failed: ${errorText(error)}`)
      return failure(`${channel} failed: ${short(errorText(error), 200)}`)
    }
  }

  return defineTool({
    name: 'act',
    description: describeTool(flows),
    input: Input,
    async run({ name: rawName, args: rawArgs, offer }, ctx) {
      const name = rawName.trim()
      const parsedArgs = parseArgs(rawArgs)
      if (!parsedArgs.ok) {
        log(`${name} ${parsedArgs.error}`)
        return failure(parsedArgs.error)
      }
      if ((COACH_FLOW_NAMES as string[]).includes(name)) {
        return runCoach(name as ActCoachFlow, parsedArgs.args, offer, ctx)
      }
      const flow = flows.find((f) => f.name === name)
      if (flow) return runFlow(flow, parsedArgs.args, offer, ctx)
      const cls = Object.hasOwn(IPC_TOOL_CLASS, name)
        ? IPC_TOOL_CLASS[name as InvokeChannel]
        : undefined
      if (cls === 'act') return runIpc(name as InvokeChannel, parsedArgs.args, offer)
      log(`${name} refused (${cls ?? 'unknown'})`)
      const hint = Object.hasOwn(NOT_COACH_FLOWS, name)
        ? NOT_COACH_FLOWS[name as CoachType]
        : undefined
      if (hint) return failure(`${name} is not an act: ${hint}.`)
      if (cls === 'read') return failure(`${name} is not an act: use read or search.`)
      if (cls === 'write') return failure(`${name} is a row edit: use create, update or delete.`)
      if (cls === 'deny') return failure(`${name} is not available from the chat.`)
      return failure(`Unknown act "${short(name, 40)}". Valid names: ${validNames()}.`)
    },
  })
}
