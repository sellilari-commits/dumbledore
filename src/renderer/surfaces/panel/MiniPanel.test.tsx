/**
 * Mini panel against the mock API: the header names one subject (the focus subject, else the
 * one with the newest information), the body lists that subject's topics newest first, a topic
 * opens the full app on the subject's concepts, and the header controls send the right requests.
 */
import { useToasts } from '@renderer/design-system'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TOPICS } from './TopicList'
import { renderPanel } from './testing/render'
import { topicsOf } from './topics'

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

const topicNames = async (subject: string) => {
  const list = await screen.findByRole('list', { name: `${subject} topics` })
  return within(list)
    .getAllByRole('button')
    .map((b) => b.querySelector('.pn-topic__name')?.textContent)
}

describe('MiniPanel', () => {
  it('lists the focus subject’s topics, newest first, and nothing else', async () => {
    const r = renderPanel()
    expect(await screen.findByRole('button', { name: /subject: organic chemistry/i })).toBeTruthy()
    const expected = topicsOf(r.api.db.concepts.filter((c) => c.subjectId === 'sub_orgo'))
    expect(await topicNames('Organic Chemistry')).toEqual(expected.map((c) => c.name))
    expect(screen.queryByText(/goals & due/i)).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Ask Dumbledore' })).toBeNull()
    expect(screen.queryByText('Linear Algebra')).toBeNull()
  })

  it('without a focus, shows the subject that got new information most recently', async () => {
    renderPanel({
      prepare: (db) => {
        db.settings.focusSubjectId = null
        const linalg = db.encounters.find((e) => e.subjectId === 'sub_linalg')
        if (linalg) linalg.createdAt = new Date(Date.now() + 60_000).toISOString()
      },
    })
    expect(await screen.findByRole('button', { name: /subject: linear algebra/i })).toBeTruthy()
    expect(await screen.findByRole('list', { name: 'Linear Algebra topics' })).toBeTruthy()
  })

  it('switches subject from the header (sets focus) and can follow the latest again', async () => {
    const r = renderPanel()
    const trigger = await screen.findByRole('button', { name: /subject: organic chemistry/i })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /linear algebra/i }))
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBe('sub_linalg'))
    expect(await screen.findByRole('list', { name: 'Linear Algebra topics' })).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('button', { name: /subject: linear algebra/i }), {
      key: 'Enter',
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /follow the latest/i }))
    await waitFor(() => expect(r.api.db.settings.focusSubjectId).toBeNull())
    expect(r.calls('settings.update')).toEqual([
      { focusSubjectId: 'sub_linalg' },
      { focusSubjectId: null },
    ])
  })

  it('opens the subject’s concepts in the full app when a topic is clicked', async () => {
    const r = renderPanel()
    const list = await screen.findByRole('list', { name: 'Organic Chemistry topics' })
    fireEvent.click(within(list).getAllByRole('button')[0] as HTMLElement)
    await waitFor(() =>
      expect(r.calls('window.open')).toEqual([
        { surface: 'app', route: '/subjects/sub_orgo/concepts' },
      ]),
    )
  })

  it('pauses capture from the header switch', async () => {
    const r = renderPanel()
    const capture = await screen.findByRole('switch', { name: /pause capture/i })
    await waitFor(() => expect((capture as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(capture)
    await waitFor(() => expect(r.api.db.settings.captureEnabled).toBe(false))
    expect(r.calls('capture.setEnabled')).toEqual([false])
  })

  it('shows one calm line on the first day', async () => {
    renderPanel({ scenario: 'empty' })
    expect(await screen.findByText(EMPTY_TOPICS)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subject:/i })).toBeNull()
  })

  it('says what failed when the engine does not answer', async () => {
    renderPanel({ scenario: 'error' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/didn’t answer/)
  })

  it('closes on Esc', async () => {
    const r = renderPanel()
    await screen.findByRole('list', { name: 'Organic Chemistry topics' })
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => expect(r.calls('window.close')).toEqual(['panel']))
  })
})
