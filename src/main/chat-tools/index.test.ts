/**
 * The chat tools registry: the tools and schemas the model sees, validation and logging of every
 * call, and one turn's receipts and chips turned into the reply's actions.
 */
import type { CoachAction } from '@shared/domain'
import { describe, expect, it, vi } from 'vitest'
import { createChatTools, logInput, receiptAction } from './index'
import { chatWorld } from './testing'
import { outcome, type ToolCtx, type ToolOutcome } from './types'
import { UndoLog } from './undo'
import { createWebSearchTool, WEB_SEARCH_PER_TURN } from './web-search'

function setup(opts: { webSearch?: boolean } = {}) {
  const w = chatWorld()
  const undo = new UndoLog()
  const log = vi.fn()
  const perform = vi.fn(
    async (action: CoachAction, _ctx: ToolCtx): Promise<ToolOutcome> =>
      outcome({ ran: action.type }, { receipts: [{ line: `Ran ${action.type}`, undoId: null }] }),
  )
  const searches = vi.fn(async (query: string) => ({
    answer: `About ${query}`,
    sources: [
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/Causal_inference' },
      { title: 'Bad', url: 'javascript:alert(1)' },
    ],
  }))
  const webSearch = createWebSearchTool({ search: searches })
  const tools = createChatTools({
    repos: w.repos,
    queries: w.queries,
    memory: w.memory,
    bus: w.bus,
    undo,
    relink: null,
    nowIso: () => w.clock.nowIso(),
    perform,
    log,
    webSearch: opts.webSearch ? webSearch : null,
  })
  return { ...w, tools, undo, log, perform, searches }
}

type Schema = { type?: unknown; properties: Record<string, { type?: unknown }>; required: string[] }

describe('createChatTools: what the model sees', () => {
  it('has the six generic tools, web_search only when wired', () => {
    expect(setup().tools.specs.map((s) => s.name)).toEqual([
      'read',
      'search',
      'create',
      'update',
      'delete',
      'act',
    ])
    expect(setup({ webSearch: true }).tools.specs.map((s) => s.name)).toContain('web_search')
  })

  it('gives strict JSON schemas; data, patch and args stay strings', () => {
    const { tools } = setup()
    const byName = Object.fromEntries(tools.specs.map((s) => [s.name, s.parameters as Schema]))
    for (const schema of Object.values(byName)) {
      expect(schema.required).toEqual(Object.keys(schema.properties))
    }
    expect(byName.create?.properties.data?.type).toBe('string')
    expect(byName.update?.properties.patch?.type).toBe('string')
    expect(byName.act?.properties.args?.type).toBe('string')
    expect(byName.act?.properties.offer).toBeUndefined()
    expect(byName.delete?.properties.confirmed?.type).toBe('boolean')
  })
})

describe('createChatTools: run', () => {
  it('validates input with zod and never throws', async () => {
    const { tools, log } = setup()
    const bad = await tools.run('read', { kind: 'planets' })
    expect(bad.ok).toBe(false)
    expect((bad.result as { error: string }).error).toMatch(/^Bad input for read: kind:/)
    const unknown = await tools.run('launch', {})
    expect((unknown.result as { error: string }).error).toContain('Tools: read, search')
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[chat-tools\] read failed /))
  })

  it('reads the roadmap Ilari asked about', async () => {
    const { tools } = setup()
    const out = await tools.run('read', {
      kind: 'roadmap',
      id: 'rdm_causal',
      subjectId: null,
      conceptId: null,
      limit: null,
    })
    expect(out.ok).toBe(true)
    expect(JSON.stringify(out.result)).toContain('Heteroskedastic and Post-Nonlinear Models')
  })

  it('logs name, ok and a short redacted input', async () => {
    const { tools, log } = setup()
    await tools.run('search', { query: 'causal', limit: null })
    expect(log).toHaveBeenLastCalledWith('[chat-tools] search ok {"limit":null,"query":"causal"}')
    const secret = `sk-${'a1B2c3D4e5'.repeat(5)}`
    expect(logInput({ patch: `{"key":"${secret}"}` })).not.toContain(secret)
    expect(logInput({ text: 'x'.repeat(500) }).length).toBeLessThanOrEqual(120)
  })
})

describe('createChatTools: a turn', () => {
  it('collects receipts as labelled undo_saves, and nothing else (no chips)', async () => {
    const { tools, repos, stats, undo } = setup()
    const turn = tools.turn()
    const created = await turn.run('create', {
      kind: 'note',
      data: JSON.stringify({ subjectId: stats.id, text: 'Colliders block paths' }),
    })
    expect(created.ok).toBe(true)
    const note = repos.notes.list({ subjectId: stats.id })[0]
    expect(note?.text).toBe('Colliders block paths')
    await turn.run('delete', { kind: 'note', id: note?.id, confirmed: false })
    await turn.run('act', { name: 'open_subject', args: { subjectId: stats.id } })
    const actions = turn.actions()
    const receipt = turn.receipts[0]
    expect(receipt?.undoId).toMatch(/^undo_/)
    expect(actions).toEqual([
      { type: 'undo_save', saveId: receipt?.undoId, label: receipt?.line },
      { type: 'undo_save', saveId: '', label: 'Ran open_subject' },
    ])
    expect(turn.calls).toEqual([
      { name: 'create', ok: true },
      { name: 'delete', ok: true },
      { name: 'act', ok: true },
    ])
    expect(repos.notes.get(note?.id ?? '')?.status).toBe('active')
    expect(await undo.undo(receipt?.undoId ?? '')).toBe(true)
    expect(repos.notes.get(note?.id ?? '')?.status).toBe('deleted')
  })

  it('passes the turn context (the student’s message) to every call', async () => {
    const { tools, perform } = setup()
    const turn = tools.turn({ message: 'clear my focus' })
    await turn.run('act', { name: 'set_focus', args: '{"subjectId":null}' })
    expect(perform).toHaveBeenCalledWith(
      { type: 'set_focus', subjectId: null },
      { message: 'clear my focus' },
    )
  })

  it('caps web searches per turn, keeps http sources, resets at the next turn', async () => {
    const { tools, searches } = setup({ webSearch: true })
    const turn = tools.turn()
    for (let i = 0; i <= WEB_SEARCH_PER_TURN; i++) {
      await turn.run('web_search', { query: `q${i}` })
    }
    expect(searches).toHaveBeenCalledTimes(WEB_SEARCH_PER_TURN)
    expect(turn.calls.at(-1)).toEqual({ name: 'web_search', ok: false })
    expect(turn.sources()).toEqual([
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/Causal_inference' },
    ])
    const next = tools.turn()
    expect(next.sources()).toEqual([])
    expect((await next.run('web_search', { query: 'again' })).ok).toBe(true)
  })

  it('receiptAction: no Undo = empty saveId', () => {
    expect(receiptAction({ line: 'Opened Exams', undoId: null })).toEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Opened Exams',
    })
  })
})
