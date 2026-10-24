/**
 * Mock handlers for app status, settings, keys, read models, subjects, inbox, prompts and
 * windows. Study, quiz, exam and chat handlers live in ./handlers-study; profile and data
 * (export, delete all) in ./handlers-account.
 */
import type { Settings } from '@shared/domain'
import type { InvokeChannel, InvokeReq } from '@shared/ipc'
import type { AppState } from '@shared/state'
import type { HandlerMap, MockContext } from './context'
import { examList, homeData, search, subjectDetail, subjectList } from './derive'
import type { AccountChannel } from './handlers-account'
import { mockId, nowIso } from './time'

type CoreChannel = Exclude<
  InvokeChannel,
  | 'session.get'
  | 'session.picker'
  | 'session.start'
  | 'session.next'
  | 'session.end'
  | 'quiz.get'
  | 'quiz.answer'
  | 'quiz.finish'
  | 'exams.create'
  | 'chat.history'
  | 'chat.send'
  | 'coach.runAction'
  | 'ask.submit'
  | 'nudge.act'
  | AccountChannel
>

type SecretKey = InvokeReq<'secrets.set'>['key']
type ProviderKey = InvokeReq<'providers.test'>

const KEY_FIELD = {
  gemini: 'geminiKeySet',
  groq: 'groqKeySet',
  mistral: 'mistralKeySet',
} as const satisfies Record<SecretKey, keyof Settings['ai']>

const KEY_NAME: Record<SecretKey, string> = { gemini: 'Gemini', groq: 'Groq', mistral: 'Mistral' }

/** Simulated round trips; OVHcloud's anonymous endpoint is the slow one. */
const LATENCY: Record<ProviderKey, number> = {
  gemini: 420,
  apple: 240,
  groq: 310,
  ovh: 880,
  mistral: 520,
}

/** Real keys are long (Gemini 39 characters, Groq 56); shorter ones are "rejected". */
const MIN_KEY_LENGTH = 12

const COLORS = ['purple', 'pink', 'yellow', 'brown', 'red', 'blue', 'green', 'orange'] as const

export function appState(ctx: MockContext): AppState {
  const { db } = ctx
  const now = Date.now()
  const p = db.appState.permissions
  if (db.grantAt.accessibility !== null && now >= db.grantAt.accessibility) p.accessibility = true
  if (db.grantAt.screenRecording !== null && now >= db.grantAt.screenRecording)
    p.screenRecording = true
  db.appState.capture.enabled = db.settings.captureEnabled
  db.appState.capture.active = db.settings.captureEnabled && p.accessibility
  db.appState.focusSubjectId = db.settings.focusSubjectId
  db.appState.onboardingDone = db.settings.onboardingDone
  return structuredClone(db.appState)
}

/** Opens another surface in a plain browser: a new tab on the matching page, still mocked. */
export function openInBrowser(surface: string, route: string | null): void {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return
  const page = surface === 'panel' ? 'panel.html' : 'app.html'
  window.open(`${page}?mock=1#${route ?? (surface === 'panel' ? '/' : '/home')}`, '_blank')
}

export const coreHandlers: HandlerMap<CoreChannel> = {
  'app.getState': (ctx) => appState(ctx),
  'settings.get': (ctx) => structuredClone(ctx.db.settings),
  'settings.update': (ctx, patch) => {
    ctx.db.settings = { ...ctx.db.settings, ...patch }
    ctx.changed('settings')
    ctx.emit('state.changed', appState(ctx))
    return structuredClone(ctx.db.settings)
  },
  'secrets.set': (ctx, { key, value }) => {
    const trimmed = value.trim()
    ctx.db.settings.ai = { ...ctx.db.settings.ai, [KEY_FIELD[key]]: trimmed.length > 0 }
    ctx.db.rejectedKeys = ctx.db.rejectedKeys.filter((k) => k !== key)
    if (trimmed.length > 0 && trimmed.length < MIN_KEY_LENGTH) ctx.db.rejectedKeys.push(key)
    ctx.changed('settings')
    ctx.emit('state.changed', appState(ctx))
  },
  'capture.setEnabled': (ctx, enabled) => {
    ctx.db.settings.captureEnabled = enabled
    ctx.changed('settings')
    ctx.emit('state.changed', appState(ctx))
  },
  'permissions.status': (ctx) => appState(ctx).permissions,
  'permissions.open': (ctx, kind) => {
    // Simulates the student flipping the switch in System Settings a moment later.
    ctx.db.grantAt[kind] = Date.now() + 2500
    ctx.later(2600, () => ctx.emit('state.changed', appState(ctx)))
  },
  'providers.test': (ctx, id) => {
    if (id === 'gemini' || id === 'groq' || id === 'mistral') {
      const saved = ctx.db.settings.ai[KEY_FIELD[id]]
      const fromEnv = id === 'gemini' && ctx.db.envKeys.gemini
      if (!saved && !fromEnv)
        return { ok: false, latencyMs: null, error: `Add a ${KEY_NAME[id]} key first.` }
      if (saved && ctx.db.rejectedKeys.includes(id))
        return {
          ok: false,
          latencyMs: null,
          error: `${KEY_NAME[id]} rejected that key (401). Check you copied all of it.`,
        }
    }
    return { ok: true, latencyMs: LATENCY[id], error: null }
  },
  'providers.usage': (ctx) => structuredClone(ctx.db.usage),

  'home.get': (ctx) => homeData(ctx.db),
  'subjects.list': (ctx) => subjectList(ctx.db),
  'subjects.get': (ctx, id) => subjectDetail(ctx.db, id),
  'inbox.list': (ctx, { state, subjectId }) =>
    ctx.db.encounters
      .filter(
        (e) =>
          (state === null || e.inboxState === state) &&
          (subjectId === null || e.subjectId === subjectId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  'exams.list': (ctx) => examList(ctx.db),
  'search.query': (ctx, q) => search(ctx.db, q),

  'subjects.create': (ctx, input) => {
    const subject = {
      id: mockId('sub'),
      name: input.name.trim(),
      emoji: input.emoji ?? '📘',
      color: COLORS[ctx.db.subjects.length % COLORS.length] ?? 'blue',
      description: '',
      goal: input.goal,
      deadline: input.deadline,
      status: 'active' as const,
      focus: 'normal' as const,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    ctx.db.subjects.push(subject)
    ctx.changed('subjects', [subject.id])
    return subject
  },
  'subjects.update': (ctx, { id, patch }) => {
    const s = ctx.db.subjects.find((x) => x.id === id)
    if (!s) throw new Error('That subject no longer exists.')
    Object.assign(s, patch, { updatedAt: nowIso() })
    ctx.changed('subjects', [id])
    return { ...s }
  },
  'subjects.delete': (ctx, { id }) => {
    const db = ctx.db
    if (!db.subjects.some((x) => x.id === id)) throw new Error('That subject no longer exists.')
    const only = (ids: string[]) => ids.length === 1 && ids[0] === id
    db.subjects = db.subjects.filter((x) => x.id !== id)
    db.concepts = db.concepts.filter((c) => c.subjectId !== id)
    db.encounters = db.encounters.filter((e) => e.subjectId !== id)
    db.assignments = db.assignments.filter((a) => a.subjectId !== id)
    db.roadmaps = db.roadmaps.filter((r) => r.subjectId !== id)
    db.quizzes = db.quizzes.filter((q) => !only(q.subjectIds))
    for (const q of db.quizzes) q.subjectIds = q.subjectIds.filter((s) => s !== id)
    db.chat = db.chat.filter((m) => m.thread !== `subject:${id}`)
    if (db.settings.focusSubjectId === id) {
      db.settings.focusSubjectId = null
      db.appState.focusSubjectId = null
    }
    ctx.changed('subjects', [id])
    ctx.changed('inbox')
  },
  'suggested.act': (ctx, { subjectId, action, intoId }) => {
    const s = ctx.db.subjects.find((x) => x.id === subjectId)
    if (!s) throw new Error('That suggestion is gone.')
    if (action === 'accept') s.status = 'active'
    if (action === 'dismiss') s.status = 'archived'
    if (action === 'merge' && intoId) {
      for (const c of ctx.db.concepts) if (c.subjectId === subjectId) c.subjectId = intoId
      for (const e of ctx.db.encounters) if (e.subjectId === subjectId) e.subjectId = intoId
      s.status = 'archived'
    }
    ctx.changed('subjects', [subjectId])
    ctx.changed('inbox')
  },
  'inbox.act': (ctx, { encounterId, action, subjectId }) => {
    const e = ctx.db.encounters.find((x) => x.id === encounterId)
    if (!e) throw new Error('That item is gone.')
    if (action === 'ignore') e.inboxState = 'ignored'
    else {
      e.inboxState = 'accepted'
      if (action === 'assign') e.subjectId = subjectId
    }
    ctx.changed('inbox', [encounterId])
  },
  'assignments.add': (ctx, input) => {
    const a = {
      id: mockId('as'),
      subjectId: input.subjectId,
      title: input.title,
      course: null,
      dueAt: input.dueAt,
      source: 'manual',
      status: 'open' as const,
      createdAt: nowIso(),
    }
    ctx.db.assignments.push(a)
    ctx.changed('assignments', [a.id])
    return a
  },

  'prompt.copy': async (_ctx, text) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {
      // Clipboard access can be denied in a plain browser; the UI still confirms.
    }
  },
  'prompt.sendToChat': (ctx) =>
    ctx.db.appState.aiChat
      ? { ok: true, reason: null }
      : { ok: false, reason: 'No AI chat is open. Open ChatGPT and try again.' },
  'prompt.write': (ctx, { context }) => ({
    pasted: ctx.db.appState.aiChat !== null,
    prompt: `I'm a student. ${context.trim()} Explain it step by step with one example.`,
  }),

  'overlay.getState': (ctx) => ({
    displayId: 1,
    orb: {
      x: 1400,
      y: 450,
      size: 40,
      visual: 'idle',
      thinking: false,
      progress: null,
      dot: 'none',
      paused: !ctx.db.settings.captureEnabled,
      docked: false,
    },
    dockTarget: null,
    edge: 'right',
    pill: null,
    side: { next: null, quiz: false },
    chip: null,
    toasts: [],
    quiz: null,
    aiChat: ctx.db.appState.aiChat,
  }),
  'overlay.action': () => undefined,
  'window.open': (ctx, { surface, route }) => {
    if (surface === ctx.surface && route) ctx.emit('navigate', { route })
    else if (surface !== ctx.surface) openInBrowser(surface, route)
  },
  'window.close': () => undefined,
  'window.setSize': () => undefined,
}
