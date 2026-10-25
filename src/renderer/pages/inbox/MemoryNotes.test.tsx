/**
 * A filed note's quiet "Move to…" on hover (NoteFileMenu over 'notes.file'), against the mock API:
 * the menu lists subjects with their topics, the move lands where the student picked and pins the
 * note, so auto-filing never moves it back.
 */
import { useToasts } from '@renderer/design-system'
import { useSubjectTree } from '@renderer/lib/memory-queries'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NoteItem } from './MemoryNotes'

/** The Organic Chemistry tree's notes as rows, like a topic of the By-topic view. */
function Notes() {
  const tree = useSubjectTree('sub_orgo')
  const notes = (tree.data?.concepts ?? []).flatMap((c) => c.notes)
  return (
    <ul>
      {notes.map((n) => (
        <NoteItem key={n.id} note={n} showSource />
      ))}
    </ul>
  )
}

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

describe('Memory page · moving a filed note', () => {
  it('moves a note to another topic from its hover menu, and pins it', async () => {
    const r = renderWithApp(<Notes />, { route: '/inbox' })
    const row = (await screen.findByText(/SN1 goes through a carbocation/)).closest(
      'li',
    ) as HTMLElement
    const trigger = within(row).getByRole('button', { name: 'Move note to another topic' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    // Subjects with their topics; the note's own topic is checked.
    expect(await screen.findByRole('menuitem', { name: /Linear Algebra/ })).toBeTruthy()
    const current = await screen.findByRole('menuitem', { name: /^SN1 mechanism/ })
    expect(current.querySelector('[aria-label="selected"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Carbocation stability' }))
    await waitFor(() =>
      expect(r.api.db.notes.find((n) => n.id === 'note_sn1')).toMatchObject({
        subjectId: 'sub_orgo',
        conceptId: 'con_carbocation',
        pinned: true,
      }),
    )
    expect(useToasts.getState().toasts[0]?.text).toMatch(/Carbocation stability/)
  })
})
