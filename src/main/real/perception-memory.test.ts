/**
 * Real engine, flow F1: scripted frames of a learning page → perception episode → prefilter →
 * extraction worker (FakeBrain) → SQLite: an Inbox encounter with the three parts and a suggested
 * subject; accepting it writes the subject's Markdown memory file.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Episode } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import { afterEach, describe, expect, it } from 'vitest'
import { CHATGPT, createRig, disposeRig, MINUTE, NOTES, type Rig, runFor, WIKI } from './test-kit'

describe('composeReal: perception → memory', () => {
  let rig: Rig
  afterEach(async () => {
    await disposeRig(rig)
  })

  it('turns a page the student read into an Inbox encounter and a suggested subject', async () => {
    rig = createRig({ compose: { tuning: { memoryDebounceMs: 0 } } })
    const { services, screen, clock, comp } = rig
    const closed: Episode[] = []
    const changes: MemoryChanged[] = []
    services.bus.on('perception:episodeClosed', ({ episode }) => closed.push(episode))
    services.bus.on('memory:changed', (change) => changes.push(change))

    screen.show(WIKI)
    await services.start()
    await runFor(clock, MINUTE)
    expect(services.perception.isActive()).toBe(true)
    expect(services.perception.now()).toMatchObject({ app: 'Google Chrome', kind: 'reading' })

    screen.show(NOTES) // switching away closes the reading episode after ~8 s
    await runFor(clock, 15_000)
    expect(closed.map((e) => e.url)).toContain(WIKI.url)
    expect(comp.engine.repos.episodes.get(closed[0]?.id ?? '')?.dwellSeconds).toBeGreaterThan(30)

    await runFor(clock, 2 * MINUTE) // the worker's flush interval
    const inbox = services.queries.inbox({ state: 'new', subjectId: null })
    expect(inbox).toHaveLength(1)
    const encounter = inbox[0]
    expect(encounter?.seen).toContain('Photosynthesis is the process')
    expect(encounter?.bigPicture).toBe('Trying to understand Photosynthesis.')
    expect(encounter?.understanding).toBe('unknown')
    expect(encounter?.source).toMatchObject({ app: 'Google Chrome', url: WIKI.url })
    expect(encounter?.openQuestions).toEqual(['How does Photosynthesis work?'])
    expect(changes.some((c) => c.scope === 'inbox')).toBe(true)

    const suggested = services.queries.subjects().filter((s) => s.status === 'suggested')
    expect(suggested.map((s) => s.name)).toEqual(['Photosynthesis'])
    const subject = suggested[0]
    expect(encounter?.subjectId).toBe(subject?.id)
    expect(services.repos.episodes.listUnextracted(10)).toEqual([])

    // Accepting the suggestion makes it a subject with a memory file (MemoryMirror via the bus).
    services.subjects.actSuggested(subject?.id ?? '', 'accept', null)
    clock.advance(10)
    const file = comp.engine.mirror()?.pathFor(subject?.id ?? '')
    expect(file).toBeTruthy()
    expect(existsSync(file ?? '')).toBe(true)
    const memory = readFileSync(file ?? '', 'utf8')
    expect(memory).toContain('Photosynthesis')
    expect(memory).toContain('Trying to understand Photosynthesis.')
  })

  it('detects an open AI chat and serves its excerpt to the study engine', async () => {
    rig = createRig()
    const { services, screen, clock } = rig
    screen.show({
      ...CHATGPT,
      lines: [
        { text: 'what is the calvin cycle', align: 'right' },
        { text: 'The Calvin cycle fixes CO2 into sugars using ATP and NADPH.', align: 'left' },
        { text: 'Ask anything', align: 'left' },
      ],
    })
    await services.start()
    await runFor(clock, 3000)
    expect(services.perception.aiChat()).toMatchObject({
      key: 'chatgpt',
      assistant: 'ChatGPT',
      pid: 501,
    })
    expect(services.perception.chatExcerpt(1000)).toContain('Student: what is the calvin cycle')
    expect(services.perception.chatExcerpt(1000)).toContain('ChatGPT: The Calvin cycle fixes CO2')
  })
})
