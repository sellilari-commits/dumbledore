/**
 * Mock study material: "Add material" pretends the student picked one PDF and files a loose
 * note from it on the subject, like main's MaterialsFlow does after reading and extracting.
 */
import type { HandlerMap } from './context'
import { mockId, nowIso } from './time'

export type MaterialsChannel = 'materials.add'

export const materialsHandlers: HandlerMap<MaterialsChannel> = {
  'materials.add': (ctx, { subjectId }) => {
    if (!ctx.db.subjects.some((s) => s.id === subjectId))
      throw new Error('That subject no longer exists.')
    const now = nowIso()
    const name = 'Lecture notes.pdf'
    ctx.db.notes.push({
      id: mockId('note'),
      subjectId,
      conceptId: null,
      encounterId: null,
      kind: 'fact',
      text: 'Added from your lecture notes: the key ideas of this subject, filed into memory.',
      keywords: [],
      source: { app: 'Study material', bundleId: 'dumbledore.material', url: null, title: name },
      status: 'active',
      mergedInto: null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    })
    ctx.changed('subjects', [subjectId])
    return [{ name, ok: true, notes: 1, truncated: false, error: null }]
  },
}
