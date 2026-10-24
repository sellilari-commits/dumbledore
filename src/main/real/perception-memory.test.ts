/**
 * Real engine, flow F1: scripted frames of a learning page → perception episode → prefilter →
 * extraction worker (FakeBrain) → SQLite: an Inbox encounter with the three parts and a suggested
 * subject; accepting it writes the subject's Markdown memory file.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Episode } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import { afterEach, describe, expect, it } from 'vitest'
import { CHATGPT, createRig, disposeRig, type Rig, runFor, WIKI } from './test-kit'

describe('composeReal: perception → memory', () => {
  let rig: Rig
  afterEach(async () => {
    await disposeRig(rig)
  })

  it('turns a page the student read into an active subject with a memory file within seconds', async () => {
    rig = createRig({ compose: { tuning: { memoryDebounceMs: 0 } } })
    const { services, screen, clock, comp } = rig
    const closed: Episode[] = []
    const changes: MemoryChanged[] = []
    services.bus.on('perception:episodeClosed', ({ episode }) => closed.push(episode))
    services.bus.on('memory:changed', (change) => changes.push(change))

    screen.show(WIKI)
    await services.start()
    // The visit's first segment closes ~12 s after the page has text; the worker judges ~5 s later.
    await runFor(clock, 30_000)
    expect(services.perception.isActive()).toBe(true)
    expect(services.perception.now()).toMatchObject({ app: 'Google Chrome', kind: 'reading' })
    expect(closed.map((e) => e.url)).toContain(WIKI.url)

    // Subjects come straight from structuring: active, no "suggested" step, no roadmap.
    const [subject] = services.queries.subjects()
    expect(subject?.name).toBe('Photosynthesis')
    expect(subject?.status).toBe('active')
    const [encounter] = services.repos.encounters.list({ subjectId: subject?.id ?? '' })
    expect(encounter?.seen).toContain('Photosynthesis is the process')
    expect(encounter?.bigPicture).toBe('Trying to understand Photosynthesis.')
    expect(encounter?.understanding).toBe('unknown')
    expect(encounter?.source).toMatchObject({ app: 'Google Chrome', url: WIKI.url })
    expect(encounter?.openQuestions).toEqual(['How does Photosynthesis work?'])
    expect(services.repos.concepts.listBySubject(subject?.id ?? '').length).toBeGreaterThan(0)
    expect(services.repos.roadmaps.listBySubject(subject?.id ?? '')).toEqual([])
    expect(changes.some((c) => c.scope === 'subjects')).toBe(true)
    expect(services.repos.episodes.listUnextracted(10)).toEqual([])

    // The new subject gets its memory file (MemoryMirror via the bus).
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
