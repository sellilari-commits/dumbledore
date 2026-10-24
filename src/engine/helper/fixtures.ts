/**
 * Default helper results and the JSON fixture format used by FakeHelper / HelperRecorder.
 *
 * A fixture scripts a helper session: per-method results returned in order (the last one
 * repeats), per-method errors, and a timeline of events. Recorded from a live helper with
 * HelperRecorder, or written by hand for tests.
 */
import { readFileSync } from 'node:fs'
import {
  HELPER_PROTOCOL_VERSION,
  type HelperEvent,
  type HelperMethod,
  type HelperResult,
  helperEvents,
  helperMethods,
} from '@shared/helper-protocol'
import { z } from 'zod'

export interface HelperFixture {
  version: 1
  description?: string
  /** Results per method, returned in order; the last one keeps repeating. */
  responses?: Partial<Record<HelperMethod, unknown[]>>
  /** Errors per method, thrown instead of results. */
  errors?: Partial<Record<HelperMethod, { code: number; message: string; data?: unknown }>>
  /** Events emitted `atMs` after replay starts. */
  events?: { atMs: number; event: HelperEvent; payload: unknown }[]
}

const methodNames = Object.keys(helperMethods) as [HelperMethod, ...HelperMethod[]]
const eventNames = Object.keys(helperEvents) as [HelperEvent, ...HelperEvent[]]

const FixtureShape = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  responses: z.partialRecord(z.enum(methodNames), z.array(z.unknown())).optional(),
  errors: z
    .partialRecord(
      z.enum(methodNames),
      z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
    )
    .optional(),
  events: z
    .array(z.object({ atMs: z.number().min(0), event: z.enum(eventNames), payload: z.unknown() }))
    .optional(),
})

/**
 * Validates a fixture: its shape, every scripted result against the method's result schema and
 * every event payload against the event schema. Throws with the first problem found.
 */
export function parseFixture(input: unknown): HelperFixture {
  const fixture = FixtureShape.parse(input) as HelperFixture
  for (const [method, results] of Object.entries(fixture.responses ?? {}) as [
    HelperMethod,
    unknown[],
  ][]) {
    results.forEach((r, i) => {
      const check = (helperMethods[method].result as z.ZodType).safeParse(r)
      if (!check.success)
        throw new Error(`fixture: responses.${method}[${i}] is not a valid result`)
    })
  }
  for (const [i, e] of (fixture.events ?? []).entries()) {
    if (!(helperEvents[e.event] as z.ZodType).safeParse(e.payload).success) {
      throw new Error(`fixture: events[${i}] (${e.event}) has an invalid payload`)
    }
  }
  return fixture
}

export function loadFixture(path: string): HelperFixture {
  return parseFixture(JSON.parse(readFileSync(path, 'utf8')))
}

const MAIN_DISPLAY = {
  id: 1,
  frame: { x: 0, y: 0, width: 1512, height: 982 },
  visibleFrame: { x: 0, y: 33, width: 1512, height: 949 },
  scale: 2,
  isMain: true,
  hasNotch: true,
}

/** What the fake answers when nothing is scripted: a healthy helper on a quiet Mac. */
export function defaultResult<M extends HelperMethod>(method: M): HelperResult<M> {
  const results: { [K in HelperMethod]: HelperResult<K> } = {
    ping: {
      version: HELPER_PROTOCOL_VERSION,
      pid: 4242,
      permissions: { accessibility: true, screenRecording: true },
    },
    'permissions.status': { accessibility: true, screenRecording: true },
    'permissions.request': { opened: true },
    frontmost: null,
    perceive: { windows: [] },
    'ax.focused': null,
    'ax.readFocusedValue': { text: null },
    'ax.selectedText': { text: null },
    'ax.findChatInput': { found: false, frame: null, ref: null, method: null },
    'input.write': { ok: true, method: 'paste', verified: true, reason: null },
    'input.click': { ok: true },
    'input.key': { ok: true },
    'app.activate': { ok: true },
    'system.idle': { seconds: 0 },
    'system.displays': { displays: [MAIN_DISPLAY] },
    'shortcut.configure': { ok: true },
    'llm.onDevice.status': { available: false, reason: 'fake', contextSize: null },
    'llm.onDevice.generate': { json: {}, tokensIn: null, tokensOut: null },
  }
  return structuredClone(results[method])
}
