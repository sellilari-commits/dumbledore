/**
 * Study picker against the mock API: subjects with their questions, keyboard and pointer
 * choice → session.start, typed goals, filtering, Esc, and the empty first day.
 */
import type { SubjectSummary } from '@shared/domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderPanel } from '../testing/render'
import { buildOptions, moveIndex, toStartInput } from './picker-options'

const input = () => screen.getByRole('combobox', { name: /what do you want to learn/i })
const active = () => screen.getByRole('option', { selected: true })

describe('Picker', () => {
  it('lists subjects with their study questions, focus subject first', async () => {
    renderPanel({ route: '/picker' })
    const list = await screen.findByRole('listbox')
    await within(list).findByText('Organic Chemistry')
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '🧪Organic ChemistryResume2 due',
      'How does hyperconjugation stabilise a carbocation?',
      'Why does a polar protic solvent speed up SN1?',
      'Is hyperconjugation the same as resonance?',
      '📐Linear AlgebraResume1 due',
      'Why does a rotation have no real eigenvectors?',
      'Why does a negative determinant mean the orientation flips?',
    ])
    expect(active().textContent).toContain('Organic Chemistry')
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute('aria-activedescendant')).toBe(active().id)
  })

  it('starts a session on a question chosen with the keyboard, then closes', async () => {
    const r = renderPanel({ route: '/picker' })
    await screen.findByText('Organic Chemistry')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(active().textContent).toBe('How does hyperconjugation stabilise a carbocation?')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(active().textContent).toContain('Organic Chemistry')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(r.calls('window.close')).toEqual(['panel']))
    expect(r.calls('session.start')).toEqual([
      {
        subjectId: 'sub_orgo',
        goal: null,
        question: 'How does hyperconjugation stabilise a carbocation?',
      },
    ])
    expect(r.history.at(-1)).toBe('/')
  })

  it('starts on a subject that is clicked', async () => {
    const r = renderPanel({ route: '/picker' })
    fireEvent.click(await screen.findByText('Linear Algebra'))
    await waitFor(() =>
      expect(r.calls('session.start')).toEqual([
        { subjectId: 'sub_linalg', goal: null, question: null },
      ]),
    )
  })

  it('filters by what is typed and learns anything typed', async () => {
    const r = renderPanel({ route: '/picker' })
    await screen.findByText('Organic Chemistry')
    fireEvent.change(input(), { target: { value: 'eigen' } })
    const texts = screen.getAllByRole('option').map((o) => o.textContent)
    expect(texts).toEqual([
      '✨Learn “eigen”New roadmap',
      '📐Linear AlgebraResume1 due',
      'Why does a rotation have no real eigenvectors?',
    ])
    expect(active().textContent).toContain('Learn “eigen”')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() =>
      expect(r.calls('session.start')).toEqual([
        { subjectId: null, goal: 'eigen', question: null },
      ]),
    )
  })

  it('closes on Esc', async () => {
    const r = renderPanel({ route: '/picker' })
    await screen.findByText('Organic Chemistry')
    fireEvent.keyDown(input(), { key: 'Escape' })
    await waitFor(() => expect(r.calls('window.close')).toEqual(['panel']))
    expect(r.calls('session.start')).toEqual([])
  })

  it('invites typing on the first day', async () => {
    renderPanel({ route: '/picker', scenario: 'empty' })
    expect(await screen.findByText(/builds a roadmap from scratch/i)).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})

describe('picker options', () => {
  const subject = (id: string, name: string) =>
    ({ id, name, emoji: '📘', dueReviews: 0 }) as SubjectSummary
  const data = {
    subjects: [
      { subject: subject('a', 'Algebra'), questions: ['What is a ring?'], hasActiveRoadmap: true },
      {
        subject: subject('b', 'Biology'),
        questions: ['Why do cells divide?'],
        hasActiveRoadmap: false,
      },
    ],
  }

  it('matches subject names and questions, custom text first', () => {
    expect(buildOptions(data, '').map((o) => o.id)).toEqual(['s:a', 'q:a:0', 's:b', 'q:b:0'])
    expect(buildOptions(data, 'cells').map((o) => o.id)).toEqual(['custom', 's:b', 'q:b:0'])
    expect(buildOptions(data, 'ALG').map((o) => o.id)).toEqual(['custom', 's:a', 'q:a:0'])
    expect(buildOptions(undefined, ' x ').map((o) => o.kind)).toEqual(['custom'])
  })

  it('maps each option to a session start and clamps movement', () => {
    const [custom, subjectOpt, question] = buildOptions(data, 'ring')
    expect(custom && toStartInput(custom)).toEqual({
      subjectId: null,
      goal: 'ring',
      question: null,
    })
    expect(subjectOpt && toStartInput(subjectOpt)).toEqual({
      subjectId: 'a',
      goal: null,
      question: null,
    })
    expect(question && toStartInput(question)).toEqual({
      subjectId: 'a',
      goal: null,
      question: 'What is a ring?',
    })
    expect(moveIndex(0, -1, 3)).toBe(0)
    expect(moveIndex(2, 1, 3)).toBe(2)
    expect(moveIndex(1, 1, 3)).toBe(2)
    expect(moveIndex(4, 1, 0)).toBe(0)
  })
})
