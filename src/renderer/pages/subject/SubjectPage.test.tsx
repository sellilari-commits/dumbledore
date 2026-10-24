/**
 * Subject page against the mock API: header (rename, icon, goal, properties), the four views,
 * prompt Copy / Send to chat, Focus, Generate exam, starting a roadmap, and the loading /
 * error / redirect states.
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

describe('SubjectPage header', () => {
  it('shows the title, properties and roadmap progress', async () => {
    renderSubject()
    expect(await screen.findByRole('heading', { name: 'Organic Chemistry', level: 1 })).toBeTruthy()
    const props = screen.getByRole('list', { name: 'Properties' })
    expect(within(props).getByText('Pass the midterm')).toBeTruthy()
    expect(within(props).getByText('Learning')).toBeTruthy()
    expect(within(props).getByText('2 reviews due')).toBeTruthy()
    expect(within(props).getByText('1 struggling')).toBeTruthy()
    expect(within(props).getByText('2 of 8 steps')).toBeTruthy()
    expect(within(props).getByText('2 h 40 min')).toBeTruthy()
    expect(within(props).getByText('Lab report: SN1 hydrolysis')).toBeTruthy()
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
    expect(await screen.findByRole('button', { name: 'Add a goal' })).toBeTruthy()
  })

  it('toggles focus off and on', async () => {
    const r = renderSubject()
    const focused = await screen.findByRole('button', { name: /focused/i })
    expect(focused.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(focused)
    await waitFor(() => expect(r.api.db.subjects[0]?.focus).toBe('normal'))
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBeNull())
    const off = await screen.findByRole('button', { name: /^focus$/i })
    expect(off.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(off)
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBe('sub_orgo'))
  })

  it('Generate exam opens the New exam dialog for this subject', async () => {
    renderSubject()
    fireEvent.click(await screen.findByRole('button', { name: /generate exam/i }))
    expect(useShell.getState().newExam).toEqual({ open: true, subjectIds: ['sub_orgo'] })
  })
})

describe('SubjectPage roadmap', () => {
  it('shows steps as to-dos and checkpoints with carried ideas', async () => {
    renderSubject()
    expect(await screen.findByRole('heading', { name: 'SN1 vs SN2' })).toBeTruthy()
    const done = screen.getByRole('checkbox', { name: 'Nucleophiles & electrophiles' })
    expect(done.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Current step')).toBeTruthy()
    expect(screen.getAllByText(/carries 1 missed idea/).length).toBe(2)
    expect(screen.getByText(/Step 3 of 8/)).toBeTruthy()
  })

  it('expands a step and copies or sends its prompt', async () => {
    const r = renderSubject()
    const spy = vi.spyOn(r.api, 'invoke')
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for Leaving groups' }))
    expect(screen.getByText(/weak-base rule/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(toastTexts()).toContain('Prompt copied'))
    expect(spy).toHaveBeenCalledWith('prompt.copy', expect.stringContaining('weak-base rule'))
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    await waitFor(() =>
      expect(toastTexts()).toContain('Pasted into your chat — press Enter to send'),
    )
    expect(spy).toHaveBeenCalledWith('prompt.sendToChat', expect.stringContaining('weak-base'))
  })

  it('says why when no chat is open to send to', async () => {
    const r = renderSubject()
    r.api.db.appState.aiChat = null
    fireEvent.click(await screen.findByRole('button', { name: 'Show details for Leaving groups' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    await waitFor(() =>
      expect(toastTexts()).toContain('No AI chat is open. Open ChatGPT and try again.'),
    )
  })

  it('starts a roadmap from the empty state of a suggested subject', async () => {
    const r = renderSubject('/subjects/sub_geo/roadmap')
    expect(await screen.findByText('No roadmap yet — start one in ChatGPT or here')).toBeTruthy()
    expect(screen.getByText(/Dumbledore suggested this subject/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /start a roadmap/i }))
    await waitFor(() => expect(r.api.db.roadmaps.some((m) => m.subjectId === 'sub_geo')).toBe(true))
    expect(await screen.findByRole('heading', { name: 'Geography', level: 2 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /add to my subjects/i }))
    await waitFor(() => expect(r.api.db.subjects[2]?.status).toBe('active'))
  })
})

describe('SubjectPage views', () => {
  it('switches views through the tabs', async () => {
    const r = renderSubject()
    fireEvent.click(await screen.findByRole('tab', { name: /concepts/i }))
    expect(r.history.at(-1)).toBe('/subjects/sub_orgo/concepts')
    expect(await screen.findByRole('table', { name: 'Concepts' })).toBeTruthy()
  })

  it('lists concepts weakest first and re-sorts by name', async () => {
    renderSubject('/subjects/sub_orgo/concepts')
    const table = await screen.findByRole('table', { name: 'Concepts' })
    const firstCells = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent)
    expect(firstCells().slice(0, 3)).toEqual([
      'Solvent effects',
      'Hyperconjugation',
      'Carbocation stability',
    ])
    expect(within(table).getAllByText('Due').length).toBe(2)
    fireEvent.keyDown(screen.getByRole('button', { name: /sort concepts/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Name' }))
    await waitFor(() => expect(firstCells()[0]).toBe('Carbocation stability'))
    expect(firstCells().at(-1)).toBe('Solvent effects')
  })

  it('shows what was seen with the three parts and the source', async () => {
    renderSubject('/subjects/sub_orgo/seen')
    const block = await screen.findByRole('article', { name: 'SN1 reaction – Wikipedia' })
    expect(within(block).getByText('Seen')).toBeTruthy()
    expect(within(block).getByText('Big picture')).toBeTruthy()
    expect(within(block).getByText('Understanding')).toBeTruthy()
    expect(within(block).getByText('Struggling')).toBeTruthy()
    expect(within(block).getByText(/en\.wikipedia\.org/)).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('lists this subject’s exams and opens one', async () => {
    const r = renderSubject('/subjects/sub_orgo/exams')
    const row = await screen.findByText('Weak-spots exam')
    expect(screen.getByText('7/10 · 70%')).toBeTruthy()
    expect(screen.queryByText(/Linear Algebra/)).toBeNull()
    fireEvent.click(row)
    expect(r.history.at(-1)).toBe('/exams/quiz_orgo_weak')
  })

  it('offers New exam when an active subject has none', async () => {
    const r = renderSubject('/subjects/sub_linalg/exams')
    expect(await screen.findByText('Due reviews')).toBeTruthy()
    r.api.db.quizzes = r.api.db.quizzes.filter((q) => !q.subjectIds.includes('sub_linalg'))
    r.api.emit('memory.changed', { scope: 'quizzes', ids: [] })
    expect(await screen.findByText('No exams for this subject yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /new exam/i }))
    expect(useShell.getState().newExam).toEqual({ open: true, subjectIds: ['sub_linalg'] })
  })

  it('offers no exams for a suggested subject until it is added', async () => {
    renderSubject('/subjects/sub_geo/exams')
    expect(await screen.findByText(/Add Geography to your subjects first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /new exam|generate exam/i })).toBeNull()
  })
})

describe('SubjectPage states', () => {
  it('shows specific loading copy', () => {
    renderSubject('/subjects/sub_orgo/seen', 'slow')
    expect(screen.getByRole('status').textContent).toContain('Loading what you’ve seen…')
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
