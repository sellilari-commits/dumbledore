import { createEngineBus } from '@engine/events'
import { describe, expect, it, vi } from 'vitest'
import { CoachActions, type CoachActionsDeps } from './coach-actions'

function setup(withAdjust = true) {
  const run = vi.fn(async () => ({ kind: 'wait', reason: 'ok' }) as never)
  const write = vi.fn()
  const deps = {
    sessions: { start: vi.fn() },
    quizzes: {},
    settings: {},
    bus: createEngineBus(),
    writer: { write },
    surfaces: {},
    overlay: { openQuiz: vi.fn() },
    roadmapAdjust: withAdjust ? { run } : undefined,
  } as unknown as CoachActionsDeps
  return { actions: new CoachActions(deps), run, write }
}

describe('CoachActions: adjust_roadmap', () => {
  it('hands the wish to RoadmapAdjust and pastes nothing', async () => {
    const t = setup()
    const action = {
      type: 'adjust_roadmap',
      subjectId: 'sub_chem',
      instruction: 'SN1 only',
    } as const
    await t.actions.run(action)
    expect(t.run).toHaveBeenCalledWith(action)
    expect(t.write).not.toHaveBeenCalled()
  })

  it('fails clearly when roadmap changes are not wired', async () => {
    const t = setup(false)
    await expect(
      t.actions.run({ type: 'adjust_roadmap', subjectId: 'sub_chem', instruction: 'x' }),
    ).rejects.toThrow(/not available/)
  })
})

describe('CoachActions: chat tool chips', () => {
  function chips(opts: { saved?: boolean; logged?: boolean; ok?: boolean } = {}) {
    const saves = { apply: vi.fn(), undo: vi.fn(() => opts.saved === true) }
    const undoLog = { undo: vi.fn(async () => opts.logged === true) }
    const run = vi.fn(async () => ({
      ok: opts.ok !== false,
      result: opts.ok === false ? { error: 'No note with id n1' } : { done: true },
      receipts: [{ line: 'Deleted note “x”', undoId: 'undo_1' }],
      chips: [],
    }))
    const chat = { append: vi.fn() }
    const chatChanged = vi.fn()
    const deps = {
      sessions: { start: vi.fn() },
      quizzes: {},
      settings: {},
      bus: createEngineBus(),
      writer: { write: vi.fn() },
      surfaces: {},
      overlay: { openQuiz: vi.fn() },
      saves,
      undoLog,
      chatTools: { run },
      chat,
      chatChanged,
    } as unknown as CoachActionsDeps
    return { actions: new CoachActions(deps), saves, undoLog, run, chat, chatChanged }
  }

  it('undo_save undoes a ChatSaves save first, else a chat tool write', async () => {
    const saved = chips({ saved: true })
    await saved.actions.run({ type: 'undo_save', saveId: 'save_1' })
    expect(saved.undoLog.undo).not.toHaveBeenCalled()
    const logged = chips({ logged: true })
    await logged.actions.run({ type: 'undo_save', saveId: 'undo_1', label: 'Renamed' })
    expect(logged.undoLog.undo).toHaveBeenCalledWith('undo_1')
    expect(logged.chatChanged).toHaveBeenCalled()
    await expect(chips().actions.run({ type: 'undo_save', saveId: 'x' })).rejects.toThrow(
      /can no longer be undone/,
    )
  })

  it('a receipt without Undo (empty saveId) undoes nothing', async () => {
    const t = chips({ saved: true, logged: true })
    await expect(
      t.actions.run({ type: 'undo_save', saveId: '', label: 'Opened Exams' }),
    ).rejects.toThrow(/no Undo/)
    expect(t.saves.undo).not.toHaveBeenCalled()
  })

  it('run_tool runs confirmed and adds the receipt with its Undo to the chat', async () => {
    const t = chips()
    await t.actions.run({
      type: 'run_tool',
      tool: 'delete',
      input: { kind: 'note', id: 'n1' },
      label: 'Delete note “x”',
    })
    expect(t.run).toHaveBeenCalledWith('delete', { kind: 'note', id: 'n1' }, { confirmed: true })
    expect(t.chat.append).toHaveBeenCalledWith({
      thread: 'ask',
      role: 'assistant',
      content: 'Done.',
      actions: [{ type: 'undo_save', saveId: 'undo_1', label: 'Deleted note “x”' }],
    })
    expect(t.chatChanged).toHaveBeenCalled()
  })

  it('a failed run_tool throws its reason and adds nothing', async () => {
    const t = chips({ ok: false })
    await expect(
      t.actions.run({ type: 'run_tool', tool: 'delete', input: {}, label: 'Delete' }),
    ).rejects.toThrow('No note with id n1')
    expect(t.chat.append).not.toHaveBeenCalled()
  })
})
