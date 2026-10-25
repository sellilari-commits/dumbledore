/**
 * The double-tap chat remembers the chat (chat-memory.ts), wired as the shell wires it: turn 1
 * creates a course and plans its roadmap through the real tools, turn 2 ("is the roadmap built?")
 * answers from the history alone, turn 3 refers to "it" and the model finds the course's id in the
 * earlier turn's tool results. "New chat" starts fresh; an Undo shows up as undone.
 */
import { describe, expect, it } from 'vitest'
import { actInput, call, chatHarness, settle } from '../chat-tools/testing'
import { ChatMemory } from './chat-memory'

/** The id the earlier create returned, read back from the history like a model would. */
const idIn = (history: { content: string }[]) =>
  history.map((m) => m.content.match(/"created":"subject","id":"([^"]+)"/)?.[1]).find(Boolean) ??
  null

describe('double-tap chat memory', () => {
  it('turn 1 creates a course, turn 2 knows the roadmap is built, turn 3 renames "it"', async () => {
    const h = chatHarness()
    await h.say('make me a course on Organic Chemistry and plan a roadmap', async function* (_, t) {
      const made = await call(t, 'create', {
        kind: 'subject',
        data: JSON.stringify({ name: 'Organic Chemistry' }),
      })
      expect(made.ok).toBe(true)
      const id = made.result.id as string
      await call(t, 'act', actInput('start_roadmap', { subjectId: id, goal: 'Organic Chemistry' }))
      yield { type: 'text', delta: 'Made the course; planning its roadmap.' }
    })
    await settle()

    await h.say('is the roadmap built?', async function* (input) {
      const all = input.history.map((m) => `${m.role}: ${m.content}`).join('\n')
      // The whole chat: the student's ask, the turn's tool calls and receipts, the planner's news.
      expect(input.history[0]).toMatchObject({
        role: 'user',
        content: expect.stringContaining('Organic'),
      })
      expect(all).toContain('Tool: create')
      expect(all).toContain('Done: Created subject “Organic Chemistry”')
      expect(all).toMatch(/Your roadmap is ready: \*\*Roadmap: Organic Chemistry\*\*/)
      yield { type: 'text', delta: 'Yes, your Organic Chemistry roadmap is ready.' }
    })

    await h.say('rename it to Organic Chemistry I', async function* (input, t) {
      const id = idIn(input.history)
      expect(id).toBeTruthy()
      expect(input.history.at(-1)?.content).toContain('roadmap is ready')
      const renamed = await call(t, 'update', {
        kind: 'subject',
        id,
        patch: JSON.stringify({ name: 'Organic Chemistry I' }),
      })
      expect(renamed.ok).toBe(true)
      yield { type: 'text', delta: 'Renamed.' }
    })
    expect(h.repos.subjects.findByName('Organic Chemistry I')).toBeTruthy()
    expect(h.inputs).toHaveLength(3)
    expect(h.inputs[2]?.history.length).toBeGreaterThanOrEqual(5)
  })

  it('"New chat" starts fresh', async () => {
    const h = chatHarness()
    await h.say('remember that colliders block paths', async function* (_, t) {
      await call(t, 'act', actInput('add_note', { text: 'Colliders block paths' }))
      yield { type: 'text', delta: 'Noted.' }
    })
    h.clock.advance(1000)
    const since = h.clock.nowIso()
    h.clock.advance(1000)
    // The Ask bar sends the time of its last "New chat" with each message.
    const submit = h.ask.submit.bind(h.ask)
    h.ask.submit = (text) => submit(text, { since })
    await h.say('hi again', async function* (input) {
      expect(input.history).toEqual([])
      yield { type: 'text', delta: 'Hi.' }
    })
  })

  it('says what the student undid', async () => {
    const h = chatHarness()
    const result = await h.say('remember that colliders block paths', async function* (_, t) {
      await call(t, 'act', actInput('add_note', { text: 'Colliders block paths' }))
      yield { type: 'text', delta: 'Noted.' }
    })
    const undo = result.actions.find((a) => a.type === 'undo_save')
    if (undo?.type !== 'undo_save') throw new Error('no undo')
    // As shell.ts wires CoachActions: a pressed Undo that worked is noted.
    const notes = new ChatMemory({ chat: h.repos.chat })
    notes.noteUndo(undo.saveId, (await h.undo.undo(undo.saveId)) || h.saves.undo(undo.saveId))
    await h.say('what did I keep?', async function* (input) {
      expect(input.history.at(-1)?.content).toContain('Undone by the student: Saved to')
      expect(input.history.at(-1)?.content).not.toContain('Done: Saved to')
      yield { type: 'text', delta: 'Nothing: you undid the note.' }
    })
  })
})
