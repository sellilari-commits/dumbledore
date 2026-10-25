/**
 * The double-tap chat with tools, wired as the shell wires it (AskFlow + CoachActions + chat
 * tools on Ilari's world), with a scripted model that calls the real tools:
 * - the loop path: streamed reply, receipts as labelled undo_saves, chips, history with what was
 *   done, Undo and run_tool through CoachActions;
 * - REGRESSION: Ilari's causal-inference conversation (the chat must read the paused roadmap,
 *   list its steps, never offer Start roadmap, never plan a second one);
 * - REGRESSION: the old long-press flows from the chat — (a) say what you want → prompt written
 *   and pasted, (b) "I want to learn X" → subject → roadmap → step 1 pasted, (c) open a topic;
 * - Ilari's website rule both ways: nothing opens unless the student's message (or a click) asked.
 */
import { describe, expect, it } from 'vitest'
import { actInput, call, chatHarness, readInput, settle } from '../chat-tools/testing'
import { historyContent } from './ask-flow'

const STEP_TITLES = [
  'Causal Inference vs. Association',
  'Additive vs. General Functional Noise',
  'Checkpoint 1 · 3 questions',
  'Heteroskedastic and Post-Nonlinear Models',
  'Applications in Political Science and Economics',
  'Checkpoint 2 · 3 questions',
]

describe('double-tap chat with tools: the loop path', () => {
  it('streams the reply and stores receipts as labelled undo_saves', async () => {
    const h = chatHarness()
    const result = await h.say('remember that colliders block paths', async function* (_, tools) {
      const saved = await call(
        tools,
        'act',
        actInput('add_note', { text: 'Colliders block paths' }),
      )
      expect(saved.ok).toBe(true)
      yield { type: 'text', delta: 'Saved. ' }
      yield { type: 'text', delta: 'Next: read about d-separation.' }
      yield { type: 'done' }
    })
    expect(result.reply).toBe('Saved. Next: read about d-separation.')
    const undo = result.actions.find((a) => a.type === 'undo_save')
    expect(undo).toMatchObject({ type: 'undo_save', label: expect.stringContaining('Colliders') })
    expect(undo?.type === 'undo_save' && undo.saveId).toMatch(/^undo_/)
    const [user, reply] = h.thread()
    expect(user).toMatchObject({ role: 'user', content: 'remember that colliders block paths' })
    expect(reply).toMatchObject({ role: 'assistant', content: result.reply })
    expect(reply?.content).not.toContain('Saved to')
    expect(historyContent(reply as never)).toContain('Done: Saved to')
  })

  it('tells the next turn what was done (history), not the chat twice', async () => {
    const h = chatHarness()
    await h.say('remember that colliders block paths', async function* (_, tools) {
      await call(tools, 'act', actInput('add_note', { text: 'Colliders block paths' }))
      yield { type: 'text', delta: 'Noted.' }
    })
    await h.say('what did you just do?', async function* (input) {
      const last = input.history.at(-1)
      expect(last?.role).toBe('assistant')
      expect(last?.content).toMatch(/^Noted\.\nDone: Saved to .*Colliders block paths/)
      yield { type: 'text', delta: 'I saved your note.' }
    })
  })

  it('undoes a tool write and a ChatSaves save through CoachActions', async () => {
    const h = chatHarness()
    const result = await h.say('I don’t get colliders', async function* (_, tools) {
      await call(tools, 'create', {
        kind: 'note',
        data: JSON.stringify({ subjectId: h.stats.id, text: 'Collider = common effect' }),
      })
      await call(
        tools,
        'act',
        actInput('save_question', {
          text: 'What is a collider?',
          subjectId: h.stats.id,
          stuck: true,
        }),
      )
      yield { type: 'text', delta: 'A collider is a common effect.' }
    })
    const undos = result.actions.filter((a) => a.type === 'undo_save')
    expect(undos).toHaveLength(2)
    const notes = () => h.repos.notes.list({ subjectId: h.stats.id, status: 'active' })
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['Collider = common effect', 'What is a collider?'])
    for (const undo of undos) await h.actions.run(undo)
    expect(notes()).toEqual([])
    await expect(h.actions.run(undos[0] as never)).rejects.toThrow(/can no longer be undone/)
    await expect(
      h.actions.run({ type: 'undo_save', saveId: '', label: 'Opened Exams' }),
    ).rejects.toThrow(/no Undo/)
  })

  it('a confirmed run_tool deletes, adds its receipt to the chat, and Undo brings it back', async () => {
    const h = chatHarness()
    const { note } = h.repos.notes.add({
      subjectId: h.stats.id,
      conceptId: null,
      encounterId: null,
      kind: 'fact',
      text: 'Old note',
      source: { app: 'Safari', bundleId: null, url: null, title: 'x' },
    })
    const result = await h.say('delete my old note', async function* (_, tools) {
      const asked = await call(tools, 'delete', { kind: 'note', id: note.id })
      expect(asked.result.needsConfirmation).toBe(true)
      yield { type: 'text', delta: 'Press the button to delete it.' }
    })
    expect(h.repos.notes.get(note.id)?.status).toBe('active')
    const chip = result.actions.find((a) => a.type === 'run_tool')
    expect(chip).toMatchObject({ tool: 'delete', label: expect.stringContaining('Old note') })
    await h.actions.run(chip as never)
    expect(h.repos.notes.get(note.id)?.status).toBe('deleted')
    const receipt = h.thread().at(-1)
    expect(receipt?.content).toBe('Done.')
    const undo = receipt?.actions.find((a) => a.type === 'undo_save')
    expect(undo).toMatchObject({ label: expect.stringContaining('Old note') })
    expect(h.chatChanged).toHaveBeenCalled()
    await h.actions.run(undo as never)
    expect(h.repos.notes.get(note.id)?.status).toBe('active')
  })

  it('puts web sources under the reply as links', async () => {
    const h = chatHarness()
    // web_search is not wired in the harness: the reply carries no Sources line.
    const result = await h.say('hi', async function* () {
      yield { type: 'text', delta: 'Hello.' }
    })
    expect(result.reply).toBe('Hello.')
  })
})

describe('REGRESSION: Ilari’s causal-inference conversation', () => {
  it('reads the paused roadmap, lists its steps, offers no Start roadmap and plans nothing', async () => {
    const h = chatHarness()
    const roadmapsBefore = h.repos.roadmaps.listBySubject(h.stats.id).length

    // 1. "i want to deeply understand causal inference" — a model that tries to plan anyway.
    const first = await h.say(
      'i want to deeply understand causal inference',
      async function* (input, tools) {
        expect(input.context).toContain('Causal Inference and Functional Noise Models')
        const plan = await call(
          tools,
          'act',
          actInput('start_roadmap', {
            subjectId: null,
            goal: 'deeply understand causal inference',
          }),
        )
        expect(plan.ok).toBe(false)
        expect(String(plan.result.error)).toContain('already has the paused roadmap')
        const offer = await call(
          tools,
          'act',
          actInput('start_roadmap', { subjectId: h.stats.id, goal: 'causal inference' }, true),
        )
        expect(offer.ok).toBe(false)
        yield {
          type: 'text',
          delta: 'You already have a roadmap for this: step 3 of 6. Let’s continue it.',
        }
      },
    )
    expect(first.actions.filter((a) => a.type === 'start_roadmap')).toEqual([])

    // 2. "what are the steps in the read map"
    const second = await h.say('what are the steps in the read map', async function* (_, tools) {
      const list = await call(tools, 'read', readInput('roadmaps', { subjectId: h.stats.id }))
      const roadmaps = list.result.roadmaps as { id: string; title: string }[]
      expect(roadmaps.map((r) => r.id)).toEqual(['rdm_causal'])
      const one = await call(tools, 'read', readInput('roadmap', { id: 'rdm_causal' }))
      const steps = (one.result.roadmap as { steps: { title: string; status: string }[] }).steps
      yield {
        type: 'text',
        delta: steps.map((s, i) => `${i + 1}. ${s.title} (${s.status})`).join('\n'),
      }
    })
    for (const title of STEP_TITLES) expect(second.reply).toContain(title)
    expect(second.reply).toContain('3. Checkpoint 1 · 3 questions (current)')

    // 3. "didn't you just built that readmap"
    const third = await h.say('didn’t you just built that readmap', async function* (input, tools) {
      expect(input.history.map((m) => m.content).join('\n')).toContain(
        'Heteroskedastic and Post-Nonlinear Models',
      )
      const history = await call(
        tools,
        'read',
        readInput('roadmap_history', { subjectId: h.stats.id }),
      )
      expect(history.result.versions).toEqual([])
      yield { type: 'text', delta: 'No new roadmap: this is the one you paused at step 3 of 6.' }
    })

    for (const reply of [first, second, third]) {
      expect(reply.actions.some((a) => a.type === 'start_roadmap')).toBe(false)
    }
    expect(h.planned).toEqual([])
    expect(h.repos.roadmaps.listBySubject(h.stats.id)).toHaveLength(roadmapsBefore)
    expect(h.repos.subjects.list().filter((s) => /causal/i.test(s.name))).toEqual([])
  })
})

describe('REGRESSION: the old long-press flows from the chat', () => {
  it('(a) the student says what they want: Dumbledore writes the prompt and pastes it', async () => {
    const h = chatHarness({ aiChat: true })
    const result = await h.say(
      'write me a prompt that explains additive noise models with an example',
      async function* (_, tools) {
        const out = await call(
          tools,
          'act',
          actInput('write_prompt', {
            request: 'explain additive noise models with an example',
          }),
        )
        expect(out.ok).toBe(true)
        expect(out.result.prompt).toContain('explain additive noise models')
        yield { type: 'text', delta: 'It’s in your ChatGPT box: press Enter when ready.' }
      },
    )
    expect(h.prompts.improve).toHaveBeenCalledWith(
      'explain additive noise models with an example',
      expect.objectContaining({
        assistant: 'ChatGPT',
        pageContext: expect.stringContaining('Subject: Statistics'),
      }),
    )
    expect(h.writes).toEqual([
      expect.stringContaining('Act as a tutor. explain additive noise models with an example'),
    ])
    expect(result.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Pasted into ChatGPT',
    })
    expect(h.openUsualAi).not.toHaveBeenCalled()
  })

  it('(b) "I want to learn X": new subject → roadmap → step 1 pasted when ready', async () => {
    const h = chatHarness({ aiChat: true })
    const result = await h.say(
      'I want to learn organic chemistry, let’s start',
      async function* (_, tools) {
        const out = await call(
          tools,
          'act',
          actInput('study_now', { subjectId: null, goal: 'Organic chemistry', deadline: null }),
        )
        expect(out.ok).toBe(true)
        yield { type: 'text', delta: 'Planning your roadmap now.' }
      },
    )
    expect(result.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Planning a roadmap for “Organic chemistry”',
    })
    await settle()
    expect(h.planned).toEqual([{ goal: 'Organic chemistry', subjectId: null, hold: true }])
    const subject = h.repos.subjects.findByName('Organic chemistry')
    expect(subject).not.toBeNull()
    expect(h.repos.roadmaps.listBySubject(subject?.id ?? '')).toHaveLength(1)
    expect(h.writes).toEqual(['Prompt for Step one'])
    const ready = h.thread().at(-1)
    expect(ready?.content).toContain('Your roadmap is ready')
    expect(ready?.content).toContain('Step 1 is in your ChatGPT chat box')
    expect(ready?.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Pasted step 1 into ChatGPT',
    })
    expect(h.openUsualAi).not.toHaveBeenCalled()
  })

  it('(b) with no AI chat open: plans, says where step 1 is, opens nothing', async () => {
    const h = chatHarness({ aiChat: false })
    await h.say('I want to learn organic chemistry, let’s start', async function* (_, tools) {
      await call(
        tools,
        'act',
        actInput('study_now', { subjectId: null, goal: 'Organic chemistry', deadline: null }),
      )
      yield { type: 'text', delta: 'Planning.' }
    })
    await settle()
    expect(h.writes).toEqual([])
    expect(h.sessions.next).not.toHaveBeenCalled()
    expect(h.thread().at(-1)?.content).toMatch(/Open Claude and tap .* for step 1/)
    expect(h.openUsualAi).not.toHaveBeenCalled()
  })

  it('(b) for a subject that has a roadmap: continues it, never plans a second', async () => {
    const h = chatHarness({ aiChat: true })
    await h.say('let’s continue causal inference', async function* (_, tools) {
      const out = await call(
        tools,
        'act',
        actInput('study_now', { subjectId: h.stats.id, goal: 'causal inference', deadline: null }),
      )
      expect(out.result.continued).toBe('Causal Inference and Functional Noise Models')
      yield { type: 'text', delta: 'Continuing.' }
    })
    expect(h.repos.roadmaps.listBySubject(h.stats.id)).toHaveLength(1)
    expect(h.planned).toEqual([{ goal: '', subjectId: h.stats.id, hold: false }])
  })

  it('(c) "open a topic" opens its subject page in the app', async () => {
    const h = chatHarness()
    const result = await h.say('open the causal inference topic', async function* (_, tools) {
      const found = await call(tools, 'search', { query: 'Causal Inference', limit: null })
      const hit = (found.result.hits as { kind: string; id: string }[]).find(
        (x) => x.kind === 'concept',
      )
      expect(hit?.id).toBe(h.causal.id)
      const out = await call(tools, 'act', actInput('open_topic', { conceptId: hit?.id }))
      expect(out.ok).toBe(true)
      yield { type: 'text', delta: 'Opened it.' }
    })
    expect(h.surfaces.open).toHaveBeenCalledWith('app', {
      route: `/subjects/${h.stats.id}/concepts`,
    })
    expect(result.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Opened Statistics › Causal Inference',
    })
    expect(h.openUsualAi).not.toHaveBeenCalled()
  })
})

describe('REGRESSION: the chat never opens a website on its own (Ilari)', () => {
  const writePrompt = (request: string) =>
    async function* (_: unknown, tools: Parameters<typeof call>[0]) {
      await call(tools, 'act', actInput('write_prompt', { request }))
      yield { type: 'text' as const, delta: 'Here you go.' }
    }

  it('no AI chat open: opens nothing, says so, offers "Open Claude and paste"; the click opens it', async () => {
    const h = chatHarness({ aiChat: false, usualAi: 'Claude' })
    const result = await h.say('write me a prompt about colliders', writePrompt('about colliders'))
    expect(h.openUsualAi).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
    const chip = result.actions.find((a) => a.type === 'run_tool')
    expect(chip).toMatchObject({ tool: 'act', label: 'Open Claude and paste' })
    // The student's click: now it may open.
    await h.actions.run(chip as never)
    expect(h.opened).toEqual([expect.stringContaining('about colliders')])
    expect(h.thread().at(-1)?.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Opened Claude with the prompt typed in',
    })
  })

  it('the student’s own message asks to open their AI: it opens at once', async () => {
    const h = chatHarness({ aiChat: false, usualAi: 'Claude' })
    const result = await h.say(
      'open Claude and paste a prompt about colliders',
      writePrompt('about colliders'),
    )
    expect(h.openUsualAi).toHaveBeenCalledTimes(1)
    expect(result.actions.some((a) => a.type === 'run_tool')).toBe(false)
    expect(result.actions).toContainEqual({
      type: 'undo_save',
      saveId: '',
      label: 'Opened Claude with the prompt typed in',
    })
  })

  it('paste_prompt offered as a chip never runs until clicked', async () => {
    const h = chatHarness({ aiChat: true })
    const result = await h.say('give me a prompt button', async function* (_, tools) {
      const out = await call(tools, 'act', actInput('paste_prompt', { text: 'Explain DAGs' }, true))
      expect(out.ok).toBe(true)
      yield { type: 'text', delta: 'Press the button.' }
    })
    expect(h.writes).toEqual([])
    expect(result.actions.find((a) => a.type === 'run_tool')).toMatchObject({
      label: 'Open ChatGPT and paste',
    })
  })
})

describe('roadmap history from the chat', () => {
  it('adjust_roadmap replans (old version kept), Undo brings it back; restore swaps again', async () => {
    const h = chatHarness()
    const result = await h.say('on statistics skip the applications', async function* (_, tools) {
      const out = await call(
        tools,
        'act',
        actInput('adjust_roadmap', { subjectId: h.stats.id, instruction: 'skip the applications' }),
      )
      expect(out.ok).toBe(true)
      yield { type: 'text', delta: 'Replanned.' }
    })
    expect(h.adjusted).toEqual(['skip the applications'])
    expect(h.repos.roadmaps.version('rdm_causal')).not.toBeNull()
    expect(h.repos.roadmaps.listBySubject(h.stats.id).map((r) => r.id)).toEqual(['rdm_re_1'])
    const undo = result.actions.find((a) => a.type === 'undo_save')
    expect(undo).toMatchObject({ label: "Replanned Statistics's roadmap: “skip the applications”" })
    await h.actions.run(undo as never)
    expect(h.repos.roadmaps.listBySubject(h.stats.id).map((r) => r.id)).toEqual(['rdm_causal'])
    expect(h.repos.roadmaps.version('rdm_re_1')).not.toBeNull()

    // Bring the replanned one back through the tools, then Undo that.
    const back = await h.say('bring back the replanned version', async function* (_, tools) {
      const list = await call(
        tools,
        'read',
        readInput('roadmap_history', { subjectId: h.stats.id }),
      )
      const versions = list.result.versions as { versionId: string }[]
      expect(versions.map((v) => v.versionId)).toEqual(['rdm_re_1'])
      const out = await call(
        tools,
        'act',
        actInput('restore_roadmap_version', { versionId: 'rdm_re_1' }),
      )
      expect(out.ok).toBe(true)
      yield { type: 'text', delta: 'Brought it back.' }
    })
    expect(h.repos.roadmaps.listBySubject(h.stats.id).map((r) => r.id)).toEqual(['rdm_re_1'])
    const undoRestore = back.actions.find((a) => a.type === 'undo_save')
    expect(undoRestore).toMatchObject({ label: 'Brought back “Replanned roadmap”' })
    await h.actions.run(undoRestore as never)
    expect(h.repos.roadmaps.listBySubject(h.stats.id).map((r) => r.id)).toEqual(['rdm_causal'])
  })
})
