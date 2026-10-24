/**
 * Memory page against the mock API: By topic (subjects, topics with their big picture and sources,
 * notes), Recent (by day, one entry per page), links to the source pages, edit and delete in
 * place, filing a loose note, search, and the empty / error states. No Keep / Ignore anywhere.
 */
import { useToasts } from '@renderer/design-system'
import { renderWithApp } from '@renderer/lib/test-utils'
import { AppSidebar } from '@renderer/surfaces/app/AppSidebar'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPage } from './InboxPage'

const render = (scenario?: 'empty' | 'error') =>
  renderWithApp(<InboxPage />, { route: '/inbox', scenario })

async function pick(trigger: HTMLElement, item: RegExp) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

const topicRow = async (name: string) =>
  (await screen.findByRole('button', { name })).closest('li') as HTMLElement

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

describe('Memory page · By topic', () => {
  it('lists subjects with their topics, big picture and sources', async () => {
    render()
    expect(await screen.findByRole('region', { name: 'Organic Chemistry' })).toBeTruthy()
    const topic = await topicRow('Carbocation stability')
    expect(within(topic).getByText(/3° > 2° > 1° > methyl/)).toBeTruthy()
    const sources = within(topic).getByRole('region', { name: 'Sources for Carbocation stability' })
    expect(within(sources).getAllByTestId('mem-source')).toHaveLength(2)
    expect(within(sources).getByText('Carbocation – LibreTexts')).toBeTruthy()
    expect(within(sources).getByText(/hyperconjugation/)).toBeTruthy()
  })

  it('links a source to its page, and shows a plain name when there is no url', async () => {
    render()
    const topic = await topicRow('Carbocation stability')
    const link = within(topic).getByRole('link', { name: 'Carbocation – LibreTexts' })
    expect(link.getAttribute('href')).toBe('https://chem.libretexts.org/Carbocation')
    expect(link.getAttribute('target')).toBe('_blank')
    // The ChatGPT note has no url: its source is plain text, not a link.
    expect(within(topic).getByText('ChatGPT')).toBeTruthy()
    expect(within(topic).queryByRole('link', { name: 'ChatGPT' })).toBeNull()
  })

  it('ends each topic with a link that opens all the text extracted about it', async () => {
    const r = render()
    const topic = await topicRow('Carbocation stability')
    const invoke = vi.spyOn(r.api, 'invoke')
    const link = within(topic).getByRole('button', {
      name: 'All extracted text about Carbocation stability',
    })
    expect(link.textContent).toBe('All extracted text')
    fireEvent.click(link)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('concepts.openText', 'con_carbocation'))
    // A topic with only a big picture gets the link too.
    const plain = await topicRow('Electrophiles')
    expect(
      within(plain).getByRole('button', { name: 'All extracted text about Electrophiles' }),
    ).toBeTruthy()
  })

  it('has no Keep / Ignore, no suggested subjects and no capture line', async () => {
    render()
    await screen.findByRole('region', { name: 'Organic Chemistry' })
    expect(screen.queryByRole('button', { name: /^Keep/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Ignore/ })).toBeNull()
    expect(screen.queryByText('Suggested subjects')).toBeNull()
    expect(screen.queryByText(/Watching your screen/)).toBeNull()
  })

  it('edits a note in place', async () => {
    const r = render()
    const topic = await topicRow('SN1 mechanism')
    fireEvent.click(within(topic).getByRole('button', { name: 'Edit note' }))
    const box = within(topic).getByRole('textbox', { name: 'Edit note' })
    fireEvent.change(box, { target: { value: 'SN1: rate depends only on the substrate.' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() =>
      expect(r.api.db.notes.find((n) => n.id === 'note_sn1')?.text).toBe(
        'SN1: rate depends only on the substrate.',
      ),
    )
  })

  it("edits a topic's big picture in place", async () => {
    const r = render()
    const topic = await topicRow('Carbocation stability')
    fireEvent.click(
      within(topic).getByRole('button', { name: 'Edit the big picture of Carbocation stability' }),
    )
    const box = within(topic).getByRole('textbox', {
      name: 'Big picture of Carbocation stability',
    })
    fireEvent.change(box, { target: { value: 'More alkyl groups, more stable cation.' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() =>
      expect(r.api.db.concepts.find((c) => c.name === 'Carbocation stability')?.summary).toBe(
        'More alkyl groups, more stable cation.',
      ),
    )
    expect(await within(topic).findByText('More alkyl groups, more stable cation.')).toBeTruthy()
  })

  it('deletes a note with its ✕', async () => {
    const r = render()
    const topic = await topicRow('SN1 mechanism')
    fireEvent.click(within(topic).getByRole('button', { name: 'Delete note' }))
    await waitFor(() =>
      expect(r.api.db.notes.find((n) => n.id === 'note_sn1')?.status ?? 'gone').not.toBe('active'),
    )
  })

  it('renames a topic and deletes one after a confirm', async () => {
    const r = render()
    const topic = await topicRow('SN1 mechanism')
    fireEvent.click(within(topic).getByRole('button', { name: 'Rename SN1 mechanism' }))
    const input = within(topic).getByRole('textbox', { name: 'Topic name' })
    fireEvent.change(input, { target: { value: 'SN1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(r.api.db.concepts.find((c) => c.id === 'con_sn1')?.name).toBe('SN1'))
    const leaving = await topicRow('Leaving groups')
    fireEvent.click(within(leaving).getByRole('button', { name: 'Delete Leaving groups' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete topic' }))
    await waitFor(() => expect(r.api.db.concepts.some((c) => c.id === 'con_leaving')).toBe(false))
  })

  it('shows loose notes on top and files one to a subject', async () => {
    const r = render()
    const loose = await screen.findByRole('region', { name: 'Loose notes' })
    expect(within(loose).getAllByTestId('mem-loose')).toHaveLength(2)
    const link = within(loose).getAllByRole('link', { name: 'Tampere – Wikipedia' })[0]
    expect(link?.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Tampere')
    const trigger = within(loose).getAllByRole('button', { name: /^File “/ })[0] as HTMLElement
    await pick(trigger, /Geography/)
    await waitFor(() =>
      expect(
        r.api.db.notes.filter((n) => n.subjectId === null && n.status === 'active'),
      ).toHaveLength(1),
    )
  })

  it('search filters notes and topics', async () => {
    render()
    await topicRow('Carbocation stability')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notes' }), {
      target: { value: 'hyperconjugation' },
    })
    expect(await screen.findByText(/Alkyl groups stabilise/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'SN1 mechanism' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Loose notes' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notes' }), {
      target: { value: 'zzz-nothing' },
    })
    expect(await screen.findByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('Memory page · Recent', () => {
  it('switches to a timeline by day with one linked entry per page', async () => {
    render()
    await topicRow('Carbocation stability')
    fireEvent.click(screen.getByRole('tab', { name: /Recent/ }))
    const today = await screen.findByRole('region', { name: 'Today' })
    const entries = within(today).getAllByTestId('mem-entry')
    const tampere = entries.find((e) => within(e).queryByText('Tampere – Wikipedia'))
    expect(tampere).toBeTruthy()
    expect(within(tampere as HTMLElement).getByText(/2 notes in Loose notes/)).toBeTruthy()
    expect(
      within(tampere as HTMLElement)
        .getByRole('link', { name: 'Tampere – Wikipedia' })
        .getAttribute('href'),
    ).toBe('https://en.wikipedia.org/wiki/Tampere')
  })
})

describe('Memory in the sidebar', () => {
  it('has no new-count badge', async () => {
    const r = renderWithApp(<AppSidebar collapsed={false} />, { route: '/inbox' })
    await screen.findByText('Memory')
    expect(r.api.db.encounters.some((e) => e.inboxState === 'new')).toBe(true)
    expect(screen.queryByLabelText(/\d+ new$/)).toBeNull()
  })
})

describe('Memory page · states', () => {
  it('shows one calm line when there is nothing yet', async () => {
    render('empty')
    expect(
      await screen.findByText('Read or highlight something and it shows up here.'),
    ).toBeTruthy()
  })

  it('shows an error with a retry', async () => {
    render('error')
    expect(await screen.findByText('Couldn’t load your memory')).toBeTruthy()
  })
})
