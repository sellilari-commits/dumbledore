/**
 * NoteFileMenu: the "File to…" menu of a note on the Memory page — every subject, each with its
 * topics indented under it — saving through 'notes.file'. A loose note's "File to…" and the quiet
 * "Move to…" on a filed note's hover use the same menu. The student's choice pins the note, so
 * auto-filing (engine/subjects/note-filing.ts) never moves it again.
 *
 * The subjects and trees load only while the menu is open (Radix mounts the content then), from
 * the same queries the page already holds.
 */
import { Menu, MenuItem, MenuLabel, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useSubjectTrees } from '@renderer/lib/memory-queries'
import { useAction, useSubjects } from '@renderer/lib/queries'
import type { Concept, Note } from '@shared/domain'
import { Fragment, type ReactElement } from 'react'

const report = (err: Error) => errorToast(err)

/** Each concept with its depth below the subject (the tree comes parent-first). */
function withDepth(concepts: readonly Concept[]): { concept: Concept; depth: number }[] {
  const depth = new Map<string, number>()
  return concepts.map((concept) => {
    const d = concept.parentId ? (depth.get(concept.parentId) ?? -1) + 1 : 0
    depth.set(concept.id, d)
    return { concept, depth: d }
  })
}

function FileItems({ note, heading }: { note: Note; heading: string }) {
  const subjects = useSubjects()
  const listed = (subjects.data ?? []).filter((s) => s.status !== 'archived')
  const trees = useSubjectTrees(listed.map((s) => s.id))
  const file = useAction('notes.file', {
    onSuccess: (_n, { subjectId, conceptId }) => {
      const s = listed.find((x) => x.id === subjectId)
      const topic = trees.trees
        .flatMap((t) => t?.concepts ?? [])
        .find((c) => c.concept.id === conceptId)?.concept.name
      const where = [s ? `${s.emoji} ${s.name}` : null, topic].filter(Boolean).join(' ▸ ')
      toast(where ? `Filed under ${where}` : 'Filed', { tone: 'success' })
    },
    onError: report,
  })
  const pick = (subjectId: string, conceptId: string | null) => {
    if (subjectId === note.subjectId && conceptId === note.conceptId) return
    file.mutate({ id: note.id, subjectId, conceptId })
  }
  return (
    <>
      <MenuLabel>{heading}</MenuLabel>
      {listed.map((s, i) => (
        <Fragment key={s.id}>
          <MenuItem
            icon={s.emoji}
            checked={note.subjectId === s.id && !note.conceptId}
            disabled={file.isPending}
            onSelect={() => pick(s.id, null)}
          >
            {s.name}
            {s.status === 'suggested' ? (
              <span className="ib-select__hint"> · suggested</span>
            ) : null}
          </MenuItem>
          {withDepth((trees.trees[i]?.concepts ?? []).map((c) => c.concept)).map(
            ({ concept, depth }) => (
              <MenuItem
                key={concept.id}
                checked={note.conceptId === concept.id}
                disabled={file.isPending}
                onSelect={() => pick(s.id, concept.id)}
              >
                <span className="mem-file-menu__topic" style={{ paddingLeft: 12 + depth * 12 }}>
                  {concept.name}
                </span>
              </MenuItem>
            ),
          )}
        </Fragment>
      ))}
      {subjects.data && listed.length === 0 ? <MenuItem disabled>No subjects yet</MenuItem> : null}
    </>
  )
}

export function NoteFileMenu({
  note,
  trigger,
  heading,
  align = 'end',
}: {
  note: Note
  trigger: ReactElement
  heading: string
  align?: 'start' | 'end'
}) {
  return (
    <Menu trigger={trigger} align={align} className="mem-file-menu">
      <FileItems note={note} heading={heading} />
    </Menu>
  )
}
