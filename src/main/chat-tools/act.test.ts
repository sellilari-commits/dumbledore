import type { CoachAction } from '@shared/domain'
import { type InvokeChannel, ipcInvoke } from '@shared/ipc'
import { describe, expect, it, vi } from 'vitest'
import { ACT_CHANNELS, COACH_FLOW_NAMES, createActTool, IPC_TOOL_CLASS, parseArgs } from './act'
import { outcome, type ToolCtx, type ToolOutcome } from './types'

function setup() {
  const perform = vi.fn(
    async (action: CoachAction, _ctx: ToolCtx): Promise<ToolOutcome> =>
      outcome({ ran: action.type }, { receipts: [{ line: `Ran ${action.type}`, undoId: 'u1' }] }),
  )
  const invoke = vi.fn(async (_channel: InvokeChannel, _payload: unknown): Promise<unknown> => {
    return undefined
  })
  const log = vi.fn()
  const tool = createActTool({ perform, invoke, log })
  const call = (name: string, args: unknown = '{}', offer = false) =>
    tool.run(tool.input.parse({ name, args, offer }), {})
  return { tool, perform, invoke, log, call }
}

describe('IPC classification', () => {
  it('classifies every IPC channel and nothing else', () => {
    expect(Object.keys(IPC_TOOL_CLASS).sort()).toEqual(Object.keys(ipcInvoke).sort())
  })

  it('pins the act list', () => {
    expect([...ACT_CHANNELS].sort()).toEqual(
      [
        'inbox.act',
        'session.end',
        'session.next',
        'session.start',
        'suggested.act',
        'window.open',
      ].sort(),
    )
  })

  it('denies secrets, destructive, recursive and pasting channels', () => {
    for (const channel of [
      'secrets.set',
      'providers.test',
      'data.export',
      'data.deleteAll',
      'permissions.open',
      'permissions.reset',
      'app.relaunch',
      'capture.setEnabled',
      'subjects.delete',
      'materials.add',
      'window.setSize',
      'window.close',
      'overlay.action',
      'ask.submit',
      'chat.send',
      'coach.runAction',
      'nudge.act',
      'prompt.copy',
      'prompt.sendToChat',
      'prompt.openUsualAi',
      'prompt.write',
      'quiz.answer',
      'quiz.finish',
    ] as InvokeChannel[]) {
      expect(IPC_TOOL_CLASS[channel], channel).toBe('deny')
    }
  })
})

describe('act tool', () => {
  it('describes coach flows with their fields and the app acts', () => {
    const { tool } = setup()
    expect(tool.name).toBe('act')
    expect(tool.description).toContain(
      'start_roadmap {subjectId: string|null, goal: string, deadline?: string|null}',
    )
    expect(tool.description).toContain('count: 5|10|20')
    expect(tool.description).toContain('window.open {surface: "app"|"panel"|"askbar"')
    expect(tool.description).not.toMatch(/insert_prompt|undo_save|run_tool|give_feedback/)
    expect(COACH_FLOW_NAMES).not.toContain('update_subject')
  })

  it('refuses deny channels without invoking', async () => {
    const { call, invoke, perform, log } = setup()
    for (const name of ['secrets.set', 'data.deleteAll', 'coach.runAction', 'prompt.write']) {
      const result = await call(name, { confirm: true })
      expect(result.ok).toBe(false)
      expect(result.result).toEqual({ error: `${name} is not available from the chat.` })
    }
    expect(invoke).not.toHaveBeenCalled()
    expect(perform).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('act: secrets.set refused (deny)')
  })

  it('points reads, row edits and moved coach actions to the right tool', async () => {
    const { call } = setup()
    expect((await call('subjects.list')).result).toEqual({
      error: 'subjects.list is not an act: use read or search.',
    })
    expect((await call('notes.delete')).result).toEqual({
      error: 'notes.delete is a row edit: use create, update or delete.',
    })
    expect((await call('update_subject')).result).toEqual({
      error: "update_subject is not an act: use update with kind 'subject'.",
    })
  })

  it('fails an unknown name with the valid names', async () => {
    const { call } = setup()
    for (const name of ['launch_rockets', 'insert_prompt', 'toString']) {
      const result = await call(name)
      expect(result.ok).toBe(false)
      const { error } = result.result as { error: string }
      expect(error).toContain('Unknown act')
      expect(error).toContain('start_roadmap')
      expect(error).toContain('window.open')
    }
  })

  it('validates a coach flow and passes it to perform', async () => {
    const { call, perform } = setup()
    const result = await call(
      'start_roadmap',
      JSON.stringify({ subjectId: 's1', goal: 'Pass the exam', deadline: '2026-12-01' }),
    )
    expect(perform).toHaveBeenCalledWith(
      {
        type: 'start_roadmap',
        subjectId: 's1',
        goal: 'Pass the exam',
        deadline: '2026-12-01',
      },
      {},
    )
    expect(result.ok).toBe(true)
    expect(result.receipts).toEqual([{ line: 'Ran start_roadmap', undoId: 'u1' }])
  })

  it('fills left-out nullable fields with null and keeps type from the name', async () => {
    const { call, perform } = setup()
    await call('save_question', { text: 'Why SN1?', stuck: true, type: 'insert_prompt' })
    expect(perform).toHaveBeenCalledWith(
      {
        type: 'save_question',
        text: 'Why SN1?',
        stuck: true,
        subjectId: null,
        conceptId: null,
        topic: null,
      },
      {},
    )
  })

  it('offers a coach flow as a chip without performing it', async () => {
    const { call, perform } = setup()
    const result = await call('open_subject', '{"subjectId":"s9"}', true)
    expect(perform).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.chips).toEqual([{ type: 'open_subject', subjectId: 's9' }])
    expect(result.receipts).toEqual([])
  })

  it('refuses to offer an app action', async () => {
    const { call, invoke } = setup()
    const result = await call('session.end', '{}', true)
    expect(result.ok).toBe(false)
    expect(result.chips).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('validates an app act with its own schema and invokes it', async () => {
    const { call, invoke } = setup()
    const result = await call('window.open', { surface: 'app', route: '/exams' })
    expect(invoke).toHaveBeenCalledWith('window.open', { surface: 'app', route: '/exams' })
    expect(result.ok).toBe(true)
    expect(result.receipts).toEqual([{ line: 'Opened Exams', undoId: null }])
    expect(result.result).toEqual({ done: 'Opened Exams', undo: 'This has no Undo.' })
  })

  it('invokes a void channel without a payload and passes its result on', async () => {
    const { call, invoke } = setup()
    invoke.mockResolvedValueOnce(null)
    const result = await call('session.next', '')
    expect(invoke).toHaveBeenCalledWith('session.next', undefined)
    expect(result.receipts[0]?.line).toBe('Study session finished')
  })

  it('names the receipt after the action', async () => {
    const { call } = setup()
    const result = await call('inbox.act', { encounterId: 'e1', action: 'assign', subjectId: 's1' })
    expect(result.receipts).toEqual([{ line: 'Filed inbox item', undoId: null }])
    const started = await call('session.start', { subjectId: 's1' })
    expect(started.receipts[0]?.line).toBe('Study session started')
  })

  it('fails bad app-act args with the zod issues, without invoking', async () => {
    const { call, invoke } = setup()
    const result = await call('window.open', { surface: 'desktop', route: null })
    expect(result.ok).toBe(false)
    expect((result.result as { error: string }).error).toMatch(
      /^Bad args for window\.open: surface:/,
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('fails bad coach args with the zod issues', async () => {
    const { call, perform } = setup()
    const result = await call('create_exam', { spec: { subjectIds: [], count: 7 } })
    expect(result.ok).toBe(false)
    const { error } = result.result as { error: string }
    expect(error).toMatch(/^Bad args for create_exam: /)
    expect(error).toContain('spec.subjectIds')
    expect(error.length).toBeLessThan(360)
    expect(perform).not.toHaveBeenCalled()
  })

  it('fails bad JSON cleanly', async () => {
    const { call, perform } = setup()
    const result = await call('set_focus', '{subjectId: s1')
    expect(result.ok).toBe(false)
    expect((result.result as { error: string }).error).toMatch(/^args is not valid JSON/)
    expect((await call('set_focus', '[1,2]')).ok).toBe(false)
    expect(perform).not.toHaveBeenCalled()
  })

  it('turns a throwing perform or invoke into a failure', async () => {
    const { call, perform, invoke } = setup()
    perform.mockRejectedValueOnce(new Error('Roadmap changes are not available here.'))
    const a = await call('adjust_roadmap', { subjectId: 's1', instruction: 'SN1 only' })
    expect(a.result).toEqual({
      error: 'adjust_roadmap failed: Roadmap changes are not available here.',
    })
    invoke.mockRejectedValueOnce(new Error('No session'))
    expect((await call('session.end')).result).toEqual({ error: 'session.end failed: No session' })
  })

  it('refuses app acts when no invoke is wired', async () => {
    const tool = createActTool({ perform: vi.fn() })
    const result = await tool.run({ name: 'session.end', args: '{}', offer: false }, {})
    expect(result).toMatchObject({
      ok: false,
      result: { error: 'App actions are not available here.' },
    })
  })
})

describe('parseArgs', () => {
  it('is lenient about empty, fenced and double-encoded args', () => {
    expect(parseArgs('')).toEqual({ ok: true, args: {} })
    expect(parseArgs('null')).toEqual({ ok: true, args: {} })
    expect(parseArgs('```json\n{"a":1}\n```')).toEqual({ ok: true, args: { a: 1 } })
    expect(parseArgs(JSON.stringify('{"a":1}'))).toEqual({ ok: true, args: { a: 1 } })
    expect(parseArgs({ a: 1 })).toEqual({ ok: true, args: { a: 1 } })
    expect(parseArgs('"text"').ok).toBe(false)
  })
})
