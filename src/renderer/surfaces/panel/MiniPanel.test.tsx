/**
 * Mini panel against the mock API: every section renders the demo data, and each control sends
 * the right request (session.next, settings.update, capture.setEnabled, exams.create,
 * coach.runAction, window.open/close, chat.send).
 */
import { useToasts } from '@renderer/design-system'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { dueLabel } from './sections/GoalsSection'
import { renderPanel } from './testing/render'

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

const region = (name: RegExp) => screen.getByRole('region', { name })

describe('MiniPanel', () => {
  it('shows right now, the session, goals, subjects and the chat', async () => {
    renderPanel()
    expect(screen.getByText('Dumbledore')).toBeTruthy()
    expect(await screen.findByText(/SN1 reaction – Wikipedia/)).toBeTruthy()
    expect(screen.getByText('Google Chrome · en.wikipedia.org · 6 min')).toBeTruthy()
    expect(screen.getByText('Carbocation stability looks tricky')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make a roadmap' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /focus: organic chemistry/i })).toBeTruthy()
    expect(
      screen.getByRole('switch', { name: /pause capture/i }).getAttribute('aria-checked'),
    ).toBe('true')

    const session = await screen.findByRole('region', { name: /SN1 vs SN2/ })
    expect(within(session).getByText('Step 3 of 8')).toBeTruthy()
    expect(within(session).getByText('Leaving groups')).toBeTruthy()
    const current = within(session).getByText('Carbocation stability').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    expect(within(session).getByText('Checkpoint 1')).toBeTruthy()
    expect(within(session).getByText(/4 questions/)).toBeTruthy()
    expect(within(session).getByRole('button', { name: /next prompt/i })).toBeTruthy()
    expect(within(session).getByText('Pastes into ChatGPT')).toBeTruthy()

    const goals = region(/goals & due/i)
    expect(await within(goals).findByText('Problem set 4')).toBeTruthy()
    expect(within(goals).getByText('in 6 days')).toBeTruthy()
    expect(within(goals).getByText('3 reviews due')).toBeTruthy()
    expect(within(goals).getByText('5 questions on 🧪 Organic Chemistry')).toBeTruthy()

    const subjects = region(/^subjects$/i)
    expect(await within(subjects).findByText('Organic Chemistry')).toBeTruthy()
    expect(within(subjects).getByText('Linear Algebra')).toBeTruthy()
    expect(within(subjects).queryByText('Geography')).toBeNull()
    expect(within(subjects).getByText(/1 suggested subject/)).toBeTruthy()

    const chat = region(/chat with dumbledore/i)
    expect(await within(chat).findByText('What should I focus on today?')).toBeTruthy()
    expect(
      within(chat).getByRole('button', { name: /roadmap: carbocation stability/i }),
    ).toBeTruthy()
  })

  it('asks for the next step and follows the session to the checkpoint', async () => {
    const r = renderPanel()
    const session = await screen.findByRole('region', { name: /SN1 vs SN2/ })
    fireEvent.click(within(session).getByRole('button', { name: /next prompt/i }))
    await waitFor(() => expect(r.calls('session.next')).toHaveLength(1))
    expect(await within(session).findByRole('button', { name: /quiz/i })).toBeTruthy()
    const current = within(session).getByText('Checkpoint 1').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    expect(within(session).getByText('Step 4 of 8')).toBeTruthy()
  })

  it('changes the focus subject and pauses capture', async () => {
    const r = renderPanel()
    const trigger = await screen.findByRole('button', { name: /focus: organic chemistry/i })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /linear algebra/i }))
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBe('sub_linalg'))
    expect(r.calls('settings.update')).toEqual([{ focusSubjectId: 'sub_linalg' }])
    expect(await screen.findByRole('button', { name: /focus: linear algebra/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: /pause capture/i }))
    await waitFor(() => expect(r.api.db.settings.captureEnabled).toBe(false))
    expect(await screen.findByText(/capture is paused/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(r.api.db.settings.captureEnabled).toBe(true))
    expect(r.calls('capture.setEnabled')).toEqual([false, true])
  })

  it('runs the suggestion, a review and a quick exam, and opens the app', async () => {
    const r = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Make a roadmap' }))
    await waitFor(() => expect(r.calls('coach.runAction')).toHaveLength(1))
    expect(r.calls('coach.runAction')[0]).toEqual({
      type: 'start_roadmap',
      subjectId: 'sub_orgo',
      goal: 'Carbocation stability',
    })

    const goals = region(/goals & due/i)
    fireEvent.click(await within(goals).findByRole('button', { name: 'Start review' }))
    await waitFor(() => expect(r.calls('coach.runAction')).toHaveLength(2))
    expect(r.calls('coach.runAction')[1]).toEqual({
      type: 'start_review',
      conceptIds: ['con_leaving', 'con_carbocation', 'con_det'],
    })

    fireEvent.click(within(goals).getByRole('button', { name: 'Quick exam' }))
    await waitFor(() => expect(r.calls('exams.create')).toHaveLength(1))
    expect(r.calls('exams.create')[0]).toEqual({
      subjectIds: ['sub_orgo'],
      count: 5,
      focus: 'weak',
      difficulty: 'mixed',
    })
    const examId = r.api.db.quizzes.at(-1)?.id
    await waitFor(() =>
      expect(r.calls('window.open')).toContainEqual({ surface: 'app', route: `/exams/${examId}` }),
    )

    const subjects = region(/^subjects$/i)
    fireEvent.click(within(subjects).getByText('Linear Algebra'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Dumbledore' }))
    await waitFor(() =>
      expect(r.calls('window.open')).toEqual(
        expect.arrayContaining([
          { surface: 'app', route: '/subjects/sub_linalg/roadmap' },
          { surface: 'app', route: null },
        ]),
      ),
    )
  })

  it('sends a chat message, streams the reply and runs its action chip', async () => {
    const r = renderPanel()
    const input = screen.getByRole('textbox', { name: 'Ask Dumbledore' })
    fireEvent.change(input, { target: { value: 'Quiz me please' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((input as HTMLInputElement).value).toBe('')
    const chat = region(/chat with dumbledore/i)
    expect(await within(chat).findByText('Quiz me please')).toBeTruthy()
    expect(r.calls('chat.send')).toEqual([{ thread: 'panel', text: 'Quiz me please' }])
    // Streams in first (the earlier demo reply already has a "5-question exam" chip of its own).
    expect(
      await within(chat).findByText(/weighted toward what you missed/, {}, { timeout: 4000 }),
    ).toBeTruthy()
    await waitFor(
      () =>
        expect(within(chat).getAllByRole('button', { name: '5-question exam' })).toHaveLength(2),
      { timeout: 4000 },
    )
    expect(within(chat).queryByText('Thinking…')).toBeNull()
    const chip = within(chat).getAllByRole('button', { name: '5-question exam' }).at(-1)
    if (!chip) throw new Error('no chip')
    fireEvent.click(chip)
    await waitFor(() =>
      expect(r.calls('coach.runAction')).toContainEqual({
        type: 'create_exam',
        spec: { subjectIds: ['sub_orgo'], count: 5, focus: 'weak', difficulty: 'mixed' },
      }),
    )
  })

  it('closes on Esc, but Esc in the chat input clears it first', async () => {
    const r = renderPanel()
    const input = screen.getByRole('textbox', { name: 'Ask Dumbledore' })
    fireEvent.change(input, { target: { value: 'half a thought' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
    expect(r.calls('window.close')).toEqual([])
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => expect(r.calls('window.close')).toEqual(['panel']))
  })

  it('says when the roadmap is being built, and offers a retry when a step failed', async () => {
    const planning = renderPanel({ prepare: (db) => (db.sessionPhase = 'planning') })
    expect(await screen.findByText('Building your roadmap…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /next prompt/i })).toBeNull()
    planning.unmount()

    const r = renderPanel({ prepare: (db) => (db.sessionPhase = 'error') })
    const session = await screen.findByRole('region', { name: /SN1 vs SN2/ })
    expect(within(session).getByRole('alert').textContent).toMatch(/didn’t go through/)
    fireEvent.click(within(session).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(r.calls('session.next')).toHaveLength(1))
  })

  it('offers Start studying when an AI chat is open and no session runs', async () => {
    const r = renderPanel({ prepare: (db) => (db.sessionRoadmapId = null) })
    fireEvent.click(await screen.findByRole('button', { name: /start studying/i }))
    expect(r.history.at(-1)).toBe('/picker')
    expect(await screen.findByRole('combobox', { name: /what do you want to learn/i })).toBeTruthy()
  })

  it('explains how to start when no AI chat is open', async () => {
    renderPanel({
      prepare: (db) => {
        db.sessionRoadmapId = null
        db.appState.aiChat = null
      },
    })
    expect(await screen.findByText(/no session running/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start studying/i })).toBeNull()
  })

  it('shows calm empty states on the first day', async () => {
    renderPanel({ scenario: 'empty' })
    expect(await screen.findByText(/nothing to note yet/i)).toBeTruthy()
    expect(await screen.findByText(/nothing due/i)).toBeTruthy()
    expect(await screen.findByText(/no subjects yet/i)).toBeTruthy()
    expect(
      await screen.findByRole('button', { name: 'What should I focus on today?' }),
    ).toBeTruthy()
    const exam = screen.getByRole('button', { name: 'Quick exam' }) as HTMLButtonElement
    expect(exam.disabled).toBe(true)
    expect(screen.getByText('Add a subject first')).toBeTruthy()
  })

  it('says what failed when the engine does not answer', async () => {
    renderPanel({ scenario: 'error' })
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(3)
    expect(alerts[0]?.textContent).toMatch(/didn’t answer/)
  })
})

describe('dueLabel', () => {
  const now = new Date('2026-10-24T12:00:00').getTime()
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString()
  it('is short and marks what is close or late', () => {
    expect(dueLabel(at(0), now)).toEqual({ text: 'Today', tone: 'soon' })
    expect(dueLabel(at(1), now)).toEqual({ text: 'Tomorrow', tone: 'soon' })
    expect(dueLabel(at(3), now)).toEqual({ text: 'in 3 days', tone: 'soon' })
    expect(dueLabel(at(6), now)).toEqual({ text: 'in 6 days', tone: null })
    expect(dueLabel(at(49), now)).toEqual({ text: 'Dec 12', tone: null })
    expect(dueLabel(at(-2), now)).toEqual({ text: '2 days late', tone: 'late' })
  })
})
