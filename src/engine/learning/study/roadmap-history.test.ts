import { describe, expect, it } from 'vitest'
import {
  newRoadmapReason,
  replannedReason,
  restoreRoadmapVersion,
  roadmapHistory,
  SWAPPED_REASON,
  shownRoadmap,
} from './roadmap-history'
import { chat, createHarness, flush, seedSubject } from './test-helpers'

const HOUR = 3_600_000

/** A subject with a roadmap two steps in: step 1 done, step 2 current (sent). */
async function studied() {
  const h = createHarness()
  const chem = seedSubject(h.repos, 'Chemistry', { goal: 'Pass the midterm' })
  await h.service.start({ subjectId: chem.id, goal: 'SN1 vs SN2', question: null }, chat())
  await h.service.next(chat())
  h.clock.advance(HOUR) // the next checkpoint's quiz is prefetched meanwhile
  await flush()
  const first = shownRoadmap(h.repos, chem.id)
  if (!first) throw new Error('no roadmap')
  return { h, chem, first }
}

const restore = (h: ReturnType<typeof createHarness>, id: string) =>
  restoreRoadmapVersion({ repos: h.repos, bus: h.bus, clock: h.clock }, id)

describe('roadmap history — archive on replace', () => {
  it('a new roadmap for the subject keeps the old one, whole, as an earlier version', async () => {
    const { h, chem, first } = await studied()
    expect(first.items.slice(0, 2).map((i) => i.status)).toEqual(['done', 'current'])
    await h.service.start({ subjectId: chem.id, goal: 'Aromaticity', question: null }, chat())

    const shown = shownRoadmap(h.repos, chem.id)
    expect(shown?.id).not.toBe(first.id)
    expect(h.repos.roadmaps.listBySubject(chem.id).map((r) => r.id)).toEqual([shown?.id])
    const [version, ...rest] = roadmapHistory(h.repos, chem.id)
    expect(rest).toEqual([])
    expect(version).toMatchObject({
      replacedAt: h.clock.nowIso(),
      replacedBy: shown?.id,
      reason: newRoadmapReason('Aromaticity'),
      roadmap: { id: first.id, title: first.title, goal: first.goal, createdAt: first.createdAt },
    })
    expect(version?.roadmap.status).toBe('paused')
    expect(version?.roadmap.items).toEqual(first.items)
    expect(h.repos.roadmaps.get(first.id)).not.toBeNull() // never deleted
  })

  it('a replan (adjust_roadmap) plans afresh for the same goal and keeps the old one', async () => {
    const { h, chem, first } = await studied()
    // Without `replan` the same goal resumes the open roadmap…
    await h.service.start({ subjectId: chem.id, goal: first.goal, question: null }, chat())
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(first.id)
    // …with it, the roadmap is planned again and the old one goes to the history.
    await h.service.start(
      { subjectId: chem.id, goal: first.goal, question: null, replan: 'SN1, not SN2' },
      chat(),
    )
    const shown = shownRoadmap(h.repos, chem.id)
    expect(shown?.id).not.toBe(first.id)
    expect(h.service.current()?.roadmapId).toBe(shown?.id)
    expect(roadmapHistory(h.repos, chem.id)).toMatchObject([
      { roadmap: { id: first.id }, reason: replannedReason('SN1, not SN2'), replacedBy: shown?.id },
    ])
  })

  it('planning the next roadmap after a finished one keeps the finished one too', async () => {
    const { h, chem, first } = await studied()
    h.repos.roadmaps.save({ ...first, status: 'done' })
    h.service.end()
    await h.service.start({ subjectId: chem.id, goal: null, question: null }, chat())
    const [version] = roadmapHistory(h.repos, chem.id)
    expect(version?.roadmap).toMatchObject({ id: first.id, status: 'done' })
    expect(version?.reason).toBe(newRoadmapReason('Pass the midterm'))
  })

  it('leaves other subjects and parked roadmaps of the subject as they are', async () => {
    const { h, chem, first } = await studied()
    const bio = seedSubject(h.repos, 'Biology')
    await h.service.start({ subjectId: bio.id, goal: 'Krebs cycle', question: null }, chat())
    expect(roadmapHistory(h.repos, chem.id)).toEqual([])
    expect(roadmapHistory(h.repos, bio.id)).toEqual([])
    // Starting another subject's roadmap pauses this one, as before.
    expect(h.repos.roadmaps.get(first.id)?.status).toBe('paused')
  })

  it('a long reason is clipped', () => {
    expect(replannedReason('x'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})

describe('roadmap history — bring back', () => {
  async function replaced() {
    const t = await studied()
    await t.h.service.start({ subjectId: t.chem.id, goal: 'Aromaticity', question: null }, chat())
    const second = shownRoadmap(t.h.repos, t.chem.id)
    if (!second) throw new Error('no second roadmap')
    t.h.clock.advance(HOUR)
    return { ...t, second }
  }

  it('makes the earlier version current again, steps as they were, and keeps the newer one', async () => {
    const { h, chem, first, second } = await replaced()
    const changes: unknown[] = []
    h.bus.on('memory:changed', (c) => changes.push(c))

    const result = restore(h, first.id)

    expect(result.restored).toMatchObject({ id: first.id, updatedAt: h.clock.nowIso() })
    expect(result.restored.items).toEqual(first.items)
    expect(result.replaced).toEqual([second.id])
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(first.id)
    expect(roadmapHistory(h.repos, chem.id)).toMatchObject([
      { roadmap: { id: second.id }, reason: SWAPPED_REASON, replacedBy: first.id },
    ])
    expect(changes).toContainEqual({ scope: 'roadmaps', ids: [first.id, second.id] })
  })

  it('the running session follows: the next tap continues the brought-back roadmap', async () => {
    const { h, chem, first, second } = await replaced()
    expect(h.service.current()?.roadmapId).toBe(second.id)
    restore(h, first.id)
    expect(h.service.current()).toMatchObject({ roadmapId: first.id, phase: 'paused' })
    expect(h.repos.roadmaps.get(first.id)?.status).toBe('active') // took the running one's place
    const step = await h.service.next(chat())
    expect(step.kind).toBe('paste')
    expect(h.service.current()?.roadmapId).toBe(first.id)
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(first.id)
  })

  it('restoring again undoes it; nothing is ever lost', async () => {
    const { h, chem, first, second } = await replaced()
    restore(h, first.id)
    h.clock.advance(HOUR)
    restore(h, second.id)
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(second.id)
    expect(roadmapHistory(h.repos, chem.id)).toMatchObject([
      { roadmap: { id: first.id, items: first.items }, reason: SWAPPED_REASON },
    ])
    restore(h, first.id)
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(first.id)
    expect(roadmapHistory(h.repos, chem.id).map((v) => v.roadmap.id)).toEqual([second.id])
  })

  it('a finished version comes back as the one shown', async () => {
    const { h, chem, first } = await studied()
    h.repos.roadmaps.save({ ...first, status: 'done' })
    h.service.end()
    await h.service.start({ subjectId: chem.id, goal: 'Aromaticity', question: null }, chat())
    h.clock.advance(HOUR)
    const result = restore(h, first.id)
    expect(result.restored.status).toBe('done')
    expect(shownRoadmap(h.repos, chem.id)?.id).toBe(first.id)
    expect(roadmapHistory(h.repos, chem.id)).toHaveLength(1)
  })

  it('refuses the current roadmap and unknown ids', async () => {
    const { h, second } = await replaced()
    expect(() => restore(h, second.id)).toThrow('already the current one')
    expect(() => restore(h, 'rdm_missing')).toThrow('no longer exists')
  })
})
