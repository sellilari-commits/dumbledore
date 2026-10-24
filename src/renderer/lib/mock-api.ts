/**
 * In-memory implementation of the whole DumbledoreApi for a plain browser (Vite preview,
 * screenshots, tests). Realistic demo data, simulated latency and push events.
 *
 * Scenarios (?scenario=…): demo (default) · empty (first day, nothing captured) · onboarding
 * (first run) · slow (read models never resolve, to show skeletons) · error (read models fail).
 */
import type {
  DumbledoreApi,
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeRes,
} from '@shared/ipc'
import type { Handler, MockContext } from './mock/context'
import { createDb, type MockDb, type MockScenario } from './mock/db'
import { coreHandlers, openInBrowser } from './mock/handlers-core'
import { studyHandlers } from './mock/handlers-study'

export interface MockOptions {
  surface?: DumbledoreApi['surface']
  scenario?: MockScenario
  /** Fixed latency per call; default is a random 80–320 ms. */
  latencyMs?: number
}

export interface MockApi extends DumbledoreApi {
  /** The live in-memory database (tests and scenarios poke at it). */
  db: MockDb
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void
}

/** Channels that feed pages; the error/slow scenarios break exactly these. */
const READ_MODELS = new Set<InvokeChannel>([
  'home.get',
  'subjects.list',
  'subjects.get',
  'inbox.list',
  'exams.list',
  'quiz.get',
  'session.picker',
  'providers.usage',
  'chat.history',
])

const handlers = { ...coreHandlers, ...studyHandlers }

export function createMockApi(options: MockOptions = {}): MockApi {
  const surface = options.surface ?? 'app'
  const scenario = options.scenario ?? 'demo'
  const db = createDb(scenario)
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>()

  const emit: MockApi['emit'] = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) setTimeout(() => fn(payload), 0)
  }

  const ctx: MockContext = {
    db,
    surface,
    emit,
    changed: (scope, ids = []) => emit('memory.changed', { scope, ids }),
    later: (ms, fn) => {
      setTimeout(fn, ms)
    },
    openRoute: (route) => {
      if (surface === 'app') emit('navigate', { route })
      else openInBrowser('app', route)
    },
  }

  const latency = () => options.latencyMs ?? 80 + Math.random() * 240

  async function invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<InvokeRes<C>> {
    if (scenario === 'slow' && READ_MODELS.has(channel)) return new Promise(() => {})
    const wait = latency()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (scenario === 'error' && READ_MODELS.has(channel))
      throw new Error('Dumbledore’s engine didn’t answer. It may still be starting.')
    const handler = handlers[channel] as Handler<C>
    return handler(ctx, args[0] as Parameters<Handler<C>>[1])
  }

  return {
    surface,
    db,
    emit,
    invoke,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener as (payload: unknown) => void)
      listeners.set(event, set)
      return () => {
        set.delete(listener as (payload: unknown) => void)
      }
    },
  }
}
