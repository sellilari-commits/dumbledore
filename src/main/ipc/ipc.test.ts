import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type InvokeChannel, ipcInvoke } from '@shared/ipc'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  flush,
  type Harness,
  fakeExtras as harnessExtras,
  inChatGPT,
} from '../testing/harness'
import { Broadcaster, EVENT_ROUTES } from './broadcast'
import { wireBroadcasts } from './events'
import { createHandlers } from './handlers'
import {
  INVOKE_CHANNELS,
  type IpcMainLike,
  IpcValidationError,
  registerIpc,
  runHandler,
} from './register'
import type { Handlers, InvokeContext } from './types'

const APP: InvokeContext = { surface: 'app', displayId: null }
const OVERLAY: InvokeContext = { surface: 'overlay', displayId: 1 }
const exportRoot = mkdtempSync(join(tmpdir(), 'dd-ipc-'))
const fakeExtras = () => harnessExtras(join(exportRoot, 'exports'))

afterAll(() => rmSync(exportRoot, { recursive: true, force: true }))

describe('IPC handlers', () => {
  let h: Harness
  let handlers: Handlers
  let calls: string[]
  const seen = new Set<InvokeChannel>()
  const call = async <C extends InvokeChannel>(channel: C, payload?: unknown, ctx = APP) => {
    seen.add(channel)
    return runHandler(channel, handlers, payload, ctx, true)
  }

  beforeEach(async () => {
    h = await createHarness()
    const f = fakeExtras()
    handlers = createHandlers(h.core, f.extras)
    calls = f.calls
  })

  it('has a handler for every ipcInvoke channel', () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(ipcInvoke).sort())
  })

  it('answers every channel with a contract-valid response', async () => {
    const { repos } = h.services
    const orgo = repos.subjects.findByName('Organic Chemistry')
    const suggested = repos.subjects.findByName('Cell Biology')
    const encounter = repos.encounters.list({ limit: 1 })[0]
    if (!orgo || !suggested || !encounter) throw new Error('seed missing')

    expect((await call('app.getState')).helper).toBe('connected')
    expect((await call('settings.get')).theme).toBe('system')
    expect((await call('settings.update', { theme: 'dark' })).theme).toBe('dark')
    await call('secrets.set', { key: 'groq', value: 'gsk_test' })
    expect(repos.settings.get().ai.groqKeySet).toBe(true)
    expect((await call('providers.test', 'gemini')).ok).toBe(false)
    await call('secrets.set', { key: 'gemini', value: 'AIza-test' })
    expect(repos.settings.get().ai).toMatchObject({ geminiKeySet: true, groqKeySet: true })
    expect(h.services.secrets.get('gemini')).toBe('AIza-test')
    expect((await call('profile.get')).promptLanguage).toBe('auto')
    const profile = await call('profile.update', {
      aboutMe: 'Second-year chemistry student',
      level: 'BSc',
    })
    expect(profile).toMatchObject({ aboutMe: 'Second-year chemistry student', level: 'BSc' })
    expect(repos.profile.get().aboutMe).toBe('Second-year chemistry student')
    await call('capture.setEnabled', false)
    expect(h.core.appState().capture).toEqual({ enabled: false, active: false })
    await call('capture.setEnabled', true)
    expect((await call('permissions.status')).accessibility).toBe(true)
    await call('permissions.open', 'screenRecording')
    expect((await call('providers.test', 'groq')).ok).toBe(true)
    expect((await call('providers.usage')).limits.length).toBeGreaterThan(0)

    expect((await call('home.get')).continue).toEqual([])
    expect((await call('subjects.list')).length).toBe(3)
    expect((await call('subjects.get', orgo.id)).subject.name).toBe('Organic Chemistry')
    expect((await call('inbox.list', { state: null, subjectId: null })).length).toBe(2)
    expect(await call('exams.list')).toEqual([])
    expect((await call('search.query', 'carbocation')).length).toBeGreaterThan(0)

    const physics = await call('subjects.create', {
      name: 'Physics',
      emoji: '⚛️',
      goal: null,
      deadline: null,
    })
    expect((await call('subjects.update', { id: physics.id, patch: { goal: 'Pass' } })).goal).toBe(
      'Pass',
    )
    await call('suggested.act', { subjectId: suggested.id, action: 'accept', intoId: null })
    await call('inbox.act', { encounterId: encounter.id, action: 'accept', subjectId: null })
    expect(
      (await call('assignments.add', { title: 'Lab report', subjectId: null, dueAt: null })).title,
    ).toBe('Lab report')

    expect(await call('session.get')).toBeNull()
    expect((await call('session.picker')).subjects.length).toBeGreaterThan(0)
    // A step counts as delivered only once it is pasted: give the paste a chat to land in.
    await inChatGPT(h)
    const started = await call('session.start', { subjectId: orgo.id, goal: null, question: null })
    expect(started).toMatchObject({ subjectId: orgo.id, phase: 'step', index: 0 })
    expect((await call('session.next'))?.index).toBe(1)
    const atCheckpoint = await call('session.next')
    expect(atCheckpoint?.phase).toBe('checkpoint')
    const quizId = h.core.overlay.state.quiz?.quizId
    if (!quizId) throw new Error('checkpoint quiz did not open')
    const quiz = await call('quiz.get', quizId)
    const first = quiz.questions[0]
    if (!first) throw new Error('empty quiz')
    expect(
      (await call('quiz.answer', { quizId, questionId: first.id, chosenIndex: first.correctIndex }))
        .correct,
    ).toBe(true)
    expect((await call('quiz.finish', quizId)).total).toBe(quiz.questions.length)
    expect(
      (
        await call('exams.create', {
          subjectIds: [orgo.id],
          count: 5,
          focus: 'weak',
          difficulty: 'mixed',
        })
      ).status,
    ).toBe('generating')

    expect(await call('chat.history', 'panel')).toEqual([])
    const reply = await call('chat.send', { thread: 'panel', text: 'What should I focus on?' })
    expect(reply.role).toBe('assistant')
    expect(h.deltas.at(-1)).toMatchObject({ thread: 'panel', done: true })
    await call('coach.runAction', { type: 'set_focus', subjectId: orgo.id })
    expect(repos.settings.get().focusSubjectId).toBe(orgo.id)
    expect((await call('ask.submit', { text: 'What should I focus on?' })).reply).toContain('Focus')
    const nudge = repos.nudges.add({
      kind: 'tip',
      title: 'Tip',
      body: 'Try explaining it back.',
      action: null,
      dedupeKey: 'tip-1',
    })
    await call('nudge.act', { nudgeId: nudge.id, action: 'dismiss' })
    expect(repos.nudges.listSince('1970-01-01T00:00:00.000Z')[0]?.outcome).toBe('dismissed')

    await call('prompt.copy', 'copied text')
    expect(h.platform.clipboard).toBe('copied text')
    expect(await call('prompt.sendToChat', 'hello chat')).toMatchObject({ ok: true })
    await h.surfaces.open('askbar', { route: 'prompt' })
    const written = await call('prompt.write', { context: 'explain SN1 simply, exam Friday' })
    expect(written).toMatchObject({ pasted: true })
    expect(written.prompt).toContain('explain SN1 simply, exam Friday')
    expect(h.surfaces.isOpen('askbar')).toBe(false)

    expect((await call('overlay.getState')).displayId).toBe(1)
    await call('overlay.action', { type: 'hover', inside: true }, OVERLAY)
    expect(calls).toContain('interactive:1:true')
    await call('window.open', { surface: 'panel', route: '/picker' })
    expect(h.surfaces.log).toContain('open:panel:/picker')
    await call('window.close', 'panel')
    await call('window.setSize', { surface: 'askbar', width: 560, height: 200 })
    expect(calls).toContain('size:askbar:560x200')
    await call('session.end')
    expect(await call('session.get')).toBeNull()

    const { path } = await call('data.export')
    expect(calls).toContain(`reveal:${path}`)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const dump = JSON.parse(readFileSync(path, 'utf8'))
    expect(dump).toMatchObject({
      format: 'dumbledore-export',
      version: 1,
      appVersion: '0.0.0-test',
    })
    expect(dump.subjects.map((s: { name: string }) => s.name)).toContain('Physics')
    expect(dump.profile.aboutMe).toBe('Second-year chemistry student')
    expect(dump.chat.panel.length).toBe(2)
    expect(JSON.stringify(dump)).not.toContain('AIza-test')
    // Memory control: the tree, loose notes, edit (pins), file, deletes
    const source = { app: 'Chrome', bundleId: null, url: null, title: 'SN1' }
    const concept = repos.concepts.listBySubject(orgo.id)[0]
    const orgoEncounter = repos.encounters.list({ subjectId: orgo.id })[0]
    if (!concept || !orgoEncounter) throw new Error('seed missing')
    const placed = repos.notes.add({
      subjectId: orgo.id,
      conceptId: concept.id,
      encounterId: null,
      kind: 'fact',
      text: 'SN1 goes through a carbocation',
      source,
    }).note
    const loose = repos.notes.add({
      subjectId: null,
      conceptId: null,
      encounterId: null,
      kind: 'highlight',
      text: 'Tampere was founded in 1779',
      source,
    }).note
    // The fake file picker is cancelled: nothing is read.
    expect(await call('materials.add', { subjectId: orgo.id })).toEqual([])
    const tree = await call('subjects.tree', orgo.id)
    expect(tree.concepts.find((n) => n.concept.id === concept.id)?.notes.map((n) => n.id)).toEqual([
      placed.id,
    ])
    expect((await call('notes.loose')).map((n) => n.id)).toEqual([loose.id])
    const edited = await call('notes.update', {
      id: placed.id,
      text: 'SN1 forms a carbocation first',
    })
    expect(edited).toMatchObject({ text: 'SN1 forms a carbocation first', pinned: true })
    const filed = await call('notes.file', { id: loose.id, subjectId: orgo.id, conceptId: null })
    expect(filed.subjectId).toBe(orgo.id)
    await call('notes.delete', placed.id)
    expect(repos.notes.get(placed.id)?.status).toBe('deleted')
    const renamed = await call('concepts.update', {
      id: concept.id,
      summary: 'Two-step substitution',
    })
    expect(renamed.summary).toBe('Two-step substitution')
    await call('concepts.delete', concept.id)
    expect(repos.concepts.get(concept.id)).toBeNull()
    await call('encounters.delete', orgoEncounter.id)
    expect(repos.encounters.list({}).some((e) => e.id === orgoEncounter.id)).toBe(false)

    await call('subjects.delete', { id: physics.id, confirm: true })
    expect((await call('subjects.list')).map((s) => s.name)).not.toContain('Physics')
    await call('data.deleteAll', { confirm: true })
    expect(calls).toContain('deleteAll')

    expect([...seen].sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('prompt.write closes the ask bar, pastes the written prompt, and refuses an empty wish', async () => {
    await inChatGPT(h)
    await h.surfaces.open('askbar', { route: 'prompt' })
    const out = await call('prompt.write', { context: 'quiz me on SN1 vs SN2' })
    expect(out.pasted).toBe(true)
    expect(h.surfaces.log.slice(-2)).toEqual(['open:askbar:prompt', 'close:askbar'])
    expect(h.helper.callsTo('input.write').at(-1)).toMatchObject({ text: out.prompt })
    await expect(call('prompt.write', { context: '' })).rejects.toThrow(IpcValidationError)
  })

  it('refuses data.deleteAll without the explicit confirmation', async () => {
    await expect(call('data.deleteAll', {})).rejects.toThrow(IpcValidationError)
    await expect(call('data.deleteAll', { confirm: false })).rejects.toThrow(IpcValidationError)
    expect(calls).not.toContain('deleteAll')
  })

  it('rejects payloads that do not match the contract', async () => {
    await expect(call('subjects.get', '')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(
      call('quiz.answer', { quizId: 'q', questionId: 'x', chosenIndex: 7 }),
    ).rejects.toThrow(/Invalid payload for "quiz.answer"/)
    await expect(call('overlay.action', { type: 'explode' }, OVERLAY)).rejects.toThrow(
      IpcValidationError,
    )
    await expect(call('settings.update', { theme: 'neon' })).rejects.toThrow(IpcValidationError)
  })

  it('routes overlay clicks to the router without waiting for the work', async () => {
    await call('overlay.action', { type: 'orbClick' }, OVERLAY)
    await flush()
    expect(h.surfaces.log).toContain('open:panel:/')
    await call('overlay.action', { type: 'orbLongPress' }, OVERLAY)
    await flush()
    expect(h.surfaces.log).toContain('open:askbar')
    await call('overlay.action', { type: 'pillClick' }, OVERLAY)
    await flush()
    expect(h.surfaces.log).toContain('open:panel:/picker')
    await call('overlay.action', { type: 'orbContextMenu' }, OVERLAY)
    expect(calls).toContain('menu')
  })

  it('drags the orb in the coordinates of the sending overlay', async () => {
    await call('overlay.action', { type: 'orbDrag', x: 50, y: 400, done: true }, OVERLAY)
    // The orb always lives on the right edge; a drag only moves it up and down.
    expect(h.core.overlay.state.edge).toBe('right')
  })
})

describe('registerIpc', () => {
  function fakeIpc() {
    const listeners = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = {
      handle: (channel, listener) => void listeners.set(channel, listener),
      removeHandler: (channel) => void listeners.delete(channel),
    }
    return { ipc, listeners }
  }

  it('registers every channel under the invoke prefix and removes them again', async () => {
    const h = await createHarness()
    const { ipc, listeners } = fakeIpc()
    const off = registerIpc(ipc, createHandlers(h.core, fakeExtras().extras), {
      identify: (event) => (event.sender === 'trusted' ? APP : null),
    })
    expect([...listeners.keys()].sort()).toEqual(
      INVOKE_CHANNELS.map((c) => `dd:invoke:${c}`).sort(),
    )
    const getSettings = listeners.get('dd:invoke:settings.get')
    await expect(getSettings?.({ sender: 'trusted' })).resolves.toMatchObject({ theme: 'system' })
    await expect(getSettings?.({ sender: 'evil' })).rejects.toThrow(/unknown sender/)
    off()
    expect(listeners.size).toBe(0)
  })

  it('reports handler errors and invalid responses', async () => {
    const h = await createHarness()
    const { ipc, listeners } = fakeIpc()
    const errors: string[] = []
    const handlers = createHandlers(h.core, fakeExtras().extras)
    handlers['settings.get'] = () => ({ nope: true }) as never
    registerIpc(ipc, handlers, {
      identify: () => APP,
      validateResponses: true,
      onError: (channel) => void errors.push(channel),
    })
    await expect(listeners.get('dd:invoke:settings.get')?.({ sender: 1 })).rejects.toThrow(
      /invalid response/,
    )
    await expect(
      listeners.get('dd:invoke:subjects.get')?.({ sender: 1 }, 'sub_missing'),
    ).rejects.toThrow(/not found/)
    expect(errors).toEqual(['settings.get', 'subjects.get'])
  })
})

describe('Broadcaster', () => {
  it('routes events to their surfaces and validates payloads', () => {
    const sent: string[] = []
    const out = new Broadcaster(
      { send: (surfaces, channel) => void sent.push(`${surfaces.join(',')}|${channel}`) },
      true,
    )
    out.emit('memory.changed', { scope: 'subjects', ids: ['sub_1'] })
    out.emit('navigate', { route: '/home' }, ['app'])
    out.emit('navigate', { route: '/home' })
    out.emit('memory.changed', { scope: 'nonsense', ids: [] } as never)
    expect(sent).toEqual(['panel,askbar,app|dd:event:memory.changed', 'app|dd:event:navigate'])
    expect(EVENT_ROUTES['overlay.changed']).toEqual(['overlay'])
    expect(EVENT_ROUTES['key.gesture']).toEqual(['app'])
  })

  it('forwards trigger-key gestures from the helper to the app window', async () => {
    const h = await createHarness()
    const sent: { surfaces: string; channel: string; payload: unknown }[] = []
    const out = new Broadcaster(
      {
        send: (surfaces, channel, payload) =>
          void sent.push({ surfaces: surfaces.join(','), channel, payload }),
      },
      true,
    )
    const off = wireBroadcasts(h.services.bus, out)
    h.helper.emit('key.trigger', { gesture: 'holdStart', key: 'rightOption', secureInput: false })
    await flush()
    expect(sent).toContainEqual({
      surfaces: 'app',
      channel: 'dd:event:key.gesture',
      payload: { gesture: 'holdStart', key: 'rightOption' },
    })
    off()
  })
})
