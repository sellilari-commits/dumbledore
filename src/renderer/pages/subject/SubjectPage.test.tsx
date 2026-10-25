/**
 * Subject page against the mock API: the one page (description, goals, progress, gaps, what
 * Dumbledore caught), inline edits, the ⋯ menu (Focus), Make a quiz, starting a roadmap and
 * studying a gap, and the loading / error / redirect states.
 */
import { useToasts } from '@renderer/design-system'
import type { MockScenario } from '@renderer/lib/mock/db'
import { useShell } from '@renderer/lib/shell'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from 'wouter'
import { SubjectPage } from './SubjectPage'

beforeEach(() => {
  useShell.setState({ newExam: { open: false, subjectIds: [] } })
  useToasts.setState({ toasts: [] })
})

function renderSubject(route = '/subjects/sub_orgo/roadmap', scenario: MockScenario = 'demo') {
  return renderWithApp(<Route path="/subjects/:id/:view" component={SubjectPage} />, {
    route,
    scenario,
  })
}

const toastTexts = () => useToasts.getState().toasts.map((t) => t.text)

describe('SubjectPage', () => {
  it('shows description, goals, progress, gaps and what Dumbledore caught on one page', async () => {
    renderSubject()
    expect(await screen.findByRole('heading', { name: 'Organic Chemistry', level: 1 })).toBeTruthy()
    const goals = screen.getByRole('list', { name: 'Properties' })
    expect(within(goals).getByText('Pass the midterm')).toBeTruthy()
    expect(within(goals).getAllByRole('listitem').length).toBe(2)
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(within(progress).getByText(/Step 3 of 8/)).toBeTruthy()
    const gaps = screen.getByRole('region', { name: 'Your gaps' })
    expect(within(gaps).getByText('Carbocation stability')).toBeTruthy()
    // What an exam showed and what was asked in the chat, under the topic.
    expect(within(gaps).getByText(/Thought primary carbocations are the most stable/)).toBeTruthy()
    expect(within(gaps).getByText(/hyperconjugation stabilise the cation/)).toBeTruthy()
    const caught = screen.getByRole('region', { name: 'What Dumbledore caught' })
    expect(await within(caught).findByRole('region', { name: 'SN1 mechanism' })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('renames the subject inline', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Organic Chemistry' }))
    const input = screen.getByRole('textbox', { name: 'Subject name' })
    fireEvent.change(input, { target: { value: 'Orgo II' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(r.api.db.subjects[0]?.name).toBe('Orgo II'))
    expect(await screen.findByRole('heading', { name: 'Orgo II', level: 1 })).toBeTruthy()
  })

  it('Escape cancels a rename', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Organic Chemistry' }))
    const input = screen.getByRole('textbox', { name: 'Subject name' })
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Subject name' })).toBeNull()
    expect(r.api.db.subjects[0]?.name).toBe('Organic Chemistry')
  })

  it('changes the icon from the emoji picker', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Change icon' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use 🧬' }))
    await waitFor(() => expect(r.api.db.subjects[0]?.emoji).toBe('🧬'))
  })

  it('clears the goal', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Pass the midterm' }))
    const input = screen.getByRole('textbox', { name: 'Goal' })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    await waitFor(() => expect(r.api.db.subjects[0]?.goal).toBeNull())
    expect(
      await screen.findByRole('button', { name: 'What do you want to be able to do?' }),
    ).toBeTruthy()
  })

  it('turns focus off from the ⋯ menu', async () => {
    const r = renderSubject()
    fireEvent.keyDown(await screen.findByRole('button', { name: 'More' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /focus on this subject/i }))
    await waitFor(() => expect(r.api.db.subjects[0]?.focus).toBe('normal'))
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBeNull())
  })

  it('shows exam results and strengths under Progress, and Test me opens a new exam', async () => {
    const r = renderSubject()
    const progress = await screen.findByRole('region', { name: 'Progress' })
    const results = within(progress).getByRole('list', { name: 'Exam results' })
    expect(within(results).getByText('Weak-spots exam')).toBeTruthy()
    expect(within(results).getByText('7/10 · 70%')).toBeTruthy()
    expect(within(progress).getByText(/Strong:/)).toBeTruthy()
    fireEvent.click(within(progress).getByRole('button', { name: 'Test me' }))
    expect(useShell.getState().newExam).toEqual({ open: true, subjectIds: ['sub_orgo'] })
    fireEvent.click(within(results).getByRole('button', { name: /Weak-spots exam/ }))
    expect(r.history.at(-1)).toBe('/exams/quiz_orgo_weak')
  })

  it('Make a quiz opens the New exam dialog for this subject', async () => {
    renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: /make a quiz/i }))
    expect(useShell.getState().newExam).toEqual({ open: true, subjectIds: ['sub_orgo'] })
  })

  it('fixes a gap: the prompt starts from what went wrong and goes to the AI', async () => {
    const r = renderSubject()
    const invoke = vi.spyOn(r.api, 'invoke')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Fix Carbocation stability with your AI' }),
    )
    await waitFor(() => expect(invoke.mock.calls.map((c) => c[0])).toContain('prompt.sendToChat'))
    const sent = invoke.mock.calls.find((c) => c[0] === 'prompt.sendToChat')?.[1] as string
    expect(sent).toContain("I'm studying Organic Chemistry and I'm stuck on Carbocation stability.")
    expect(sent).toContain('In a quiz I thought: Thought primary carbocations are the most stable.')
    expect(sent).toContain('My question: Why does hyperconjugation')
  })

  it('studies a gap', async () => {
    renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Study Carbocation stability' }))
    await waitFor(() =>
      expect(toastTexts()).toContain('Building a roadmap for Carbocation stability…'),
    )
  })

  it('starts a roadmap for a suggested subject and keeps it', async () => {
    const r = renderSubject('/subjects/sub_geo/roadmap')
    expect(await screen.findByText(/No roadmap yet/)).toBeTruthy()
    expect(screen.getByText(/Dumbledore suggested this subject/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /make a quiz/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /start a roadmap/i }))
    await waitFor(() => expect(r.api.db.roadmaps.some((m) => m.subjectId === 'sub_geo')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /add to my subjects/i }))
    await waitFor(() => expect(r.api.db.subjects[2]?.status).toBe('active'))
  })
})

describe('SubjectPage memory', () => {
  it('shows topics as a tree with their notes, sources and prerequisites', async () => {
    renderSubject()
    const topic = await screen.findByRole('region', { name: 'SN1 mechanism' })
    expect(
      within(topic).getByText(
        'SN1 goes through a carbocation, so its rate depends only on the substrate.',
      ),
    ).toBeTruthy()
    expect(within(topic).getByText(/^ChatGPT · /)).toBeTruthy()
    expect(within(topic).getByText('Needs first: Carbocation stability')).toBeTruthy()
    const carbo = screen.getByRole('region', { name: 'Carbocation stability' })
    expect(within(carbo).getByLabelText('Highlight')).toBeTruthy()
    const loose = screen.getByRole('region', { name: 'Not in a topic yet' })
    expect(
      within(loose).getByText('Polar protic solvents stabilise ions in solution.'),
    ).toBeTruthy()
  })

  it('edits a note inline (it becomes pinned) and deletes one with its ✕', async () => {
    const r = renderSubject()
    const topic = await screen.findByRole('region', { name: 'Leaving groups' })
    fireEvent.click(within(topic).getByRole('button', { name: /^Edit note: Good leaving/ }))
    const input = within(topic).getByRole('textbox', { name: 'Edit note' })
    fireEvent.change(input, { target: { value: 'Weak bases make good leaving groups.' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(r.api.db.notes.find((n) => n.id === 'note_lg1')).toMatchObject({
        text: 'Weak bases make good leaving groups.',
        pinned: true,
      }),
    )
    const carbo = screen.getByRole('region', { name: 'Carbocation stability' })
    fireEvent.click(within(carbo).getAllByRole('button', { name: 'Delete note' })[0] as HTMLElement)
    await waitFor(() =>
      expect(r.api.db.notes.find((n) => n.id === 'note_cc1')?.status).toBe('deleted'),
    )
    expect(toastTexts()).toContain('Note deleted')
  })

  it('deletes a topic after a confirm', async () => {
    const r = renderSubject()
    const carbo = await screen.findByRole('region', { name: 'Carbocation stability' })
    fireEvent.click(
      within(carbo).getByRole('button', { name: 'Delete topic Carbocation stability' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Delete Carbocation stability?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(r.api.db.concepts.some((c) => c.id === 'con_carbocation')).toBe(false),
    )
  })

  it('adds study material and shows what it filed', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: 'Add material' }))
    await waitFor(() => expect(toastTexts()).toContain('Added Lecture notes.pdf: 1 note in memory'))
    expect(r.api.db.notes.some((n) => n.source.title === 'Lecture notes.pdf')).toBe(true)
    expect(
      await screen.findByText(
        'Added from your lecture notes: the key ideas of this subject, filed into memory.',
      ),
    ).toBeTruthy()
  })

  it('lists every capture by day in a toggle and removes one with its ✕', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: /Everything it saw, by day/ }))
    const block = await screen.findByRole('article', { name: 'SN1 reaction – Wikipedia' })
    const before = r.api.db.encounters.length
    fireEvent.click(
      within(block).getByRole('button', { name: 'Remove SN1 reaction – Wikipedia from memory' }),
    )
    await waitFor(() => expect(r.api.db.encounters.length).toBe(before - 1))
    expect(toastTexts()).toContain('Removed from memory')
  })
})

describe('SubjectPage states', () => {
  it('shows specific loading copy', () => {
    renderSubject('/subjects/sub_orgo/seen', 'slow')
    expect(screen.getByRole('status').textContent).toContain('Loading this subject…')
  })

  it('shows an error with a retry', async () => {
    renderSubject('/subjects/sub_orgo/roadmap', 'error')
    expect(await screen.findByText('Couldn’t open this subject')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('redirects an unknown view to the roadmap', async () => {
    const r = renderSubject('/subjects/sub_orgo/whatever')
    await waitFor(() => expect(r.history.at(-1)).toBe('/subjects/sub_orgo/roadmap'))
  })
})
