/**
 * The panel's topic detail with subtopics (mock `addDemoSubtopics`: Carbocation stability →
 * Hyperconjugation, Carbocation rearrangements → Hydride shifts, plus an outline passage):
 * the subtopic tree first (always fully open), a name opens the same detail, back and Esc go up
 * one level; roadmap, "Your notes" and "Extracted" start closed to one header line and open on
 * click (remembered while the panel is open); each level lists only its own notes; a note opens
 * in full on click; long sections show "Show all (N)"; long unbroken text wraps.
 */
import { useToasts } from '@renderer/design-system'
import { addDemoSubtopics } from '@renderer/lib/mock/demo-subtopics'
import type { Note } from '@shared/domain'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FLAGS, forgetOpened, NOTES_SHOWN } from './TopicDetail'
import { renderPanel } from './testing/render'

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

async function openTopic(name: string) {
  const list = await screen.findByRole('list', { name: 'Topics' })
  const row = within(list)
    .getAllByRole('button')
    .find((b) => b.textContent?.startsWith(name))
  if (!row) throw new Error(`no topic ${name}`)
  fireEvent.click(row)
  await screen.findByRole('heading', { name })
}

const nameButton = (name: string) => screen.getByRole('button', { name })

/** Opens a closed section by its header ("Roadmap", "Your notes", "Extracted"). */
async function openSection(title: string) {
  const head = await screen.findByRole('button', { name: new RegExp(`^${title}, `) })
  expect(head.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(head)
  expect(head.getAttribute('aria-expanded')).toBe('true')
  return head
}

// The stylesheets as written (vitest runs in Node; the web tsconfig has no Node types).
type Fs = { readFileSync: (path: URL, encoding: 'utf8') => string }
const fs = (
  globalThis as unknown as { process: { getBuiltinModule: (id: string) => Fs } }
).process.getBuiltinModule('node:fs')
const css = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
const panelCss = css('./panel.css')
const detailCss = css('./topic-detail.css')

/** The declarations of `selector`'s rule(s) in a stylesheet, joined. */
function rule(css: string, selector: string): string {
  const out: string[] = []
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = (m[1] as string).split(',').map((x) => x.trim())
    if (sels.includes(selector)) out.push(m[2] as string)
  }
  return out.join(';')
}

const texts = (label: string) =>
  within(screen.getByRole('list', { name: label }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.pn-note__text')?.textContent ?? '')

describe('TopicDetail with subtopics', () => {
  it('shows the subtopic tree first, then the roadmap, your notes and extracted (own only)', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    const tree = await screen.findByRole('list', { name: 'Subtopics' })
    const top = [...tree.children].map((li) => li.querySelector('.pn-topic__name')?.textContent)
    expect(top).toEqual(['Hyperconjugation', 'Carbocation rearrangements'])
    // The tree is always fully open, children indented under their parent, no chevrons.
    const nested = screen.getByRole('list', { name: 'Subtopics of Carbocation rearrangements' })
    expect(within(nested).getByRole('button', { name: 'Hydride shifts' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subtopics of/i })).toBeNull()
    // Everything else starts closed: one header line each.
    expect(screen.getByRole('button', { name: /^Roadmap, step \d+ of \d+$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Your notes, 1' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Roadmap steps' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Your notes' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Extracted' })).toBeNull()
    await openSection('Roadmap')
    await openSection('Your notes')
    await openSection('Extracted')
    const section = screen.getByRole('region', { name: 'Carbocation stability' })
    const order = [...section.querySelectorAll('ul[aria-label], ol[aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    )
    expect(order).toEqual([
      'Subtopics',
      'Subtopics of Carbocation rearrangements',
      'Roadmap steps',
      'Your notes',
      'Extracted',
    ])
    expect(texts('Your notes')).toEqual([expect.stringMatching(/stabilise the positive charge/)])
    const extracted = texts('Extracted')
    expect(extracted[0]).toMatch(/neighbouring alkyl groups/) // the outline passage
    expect(extracted.join(' ')).toMatch(/tertiary > secondary/)
    expect(extracted.join(' ')).not.toMatch(/C–H bond|hydride shift/i)
    expect(screen.getByRole('list', { name: 'Extracted' }).textContent).toMatch(
      /Wikipedia · 20 min/,
    )
    expect(screen.getByRole('list', { name: 'Extracted' }).textContent).not.toMatch(/Ilari/)
  })

  it('a click opens a note in full and closes it again; ✕ deletes it', async () => {
    const r = renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await openSection('Your notes')
    const list = await screen.findByRole('list', { name: 'Your notes' })
    const body = within(list).getAllByRole('button', { expanded: false })[0] as HTMLElement
    fireEvent.click(body)
    expect(body.getAttribute('aria-expanded')).toBe('true')
    expect(body.closest('li')?.hasAttribute('data-open')).toBe(true)
    fireEvent.click(body)
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(r.calls('notes.delete')).toEqual(['note_cc2']))
    expect(await screen.findByText(EMPTY_FLAGS)).toBeTruthy()
  })

  it('a long section shows the newest few and "Show all (N)"', async () => {
    renderPanel({
      prepare: (db) => {
        addDemoSubtopics(db)
        const base = db.notes.find((n) => n.id === 'note_cc1') as Note
        for (let i = 0; i < 6; i++) db.notes.push({ ...base, id: `note_x${i}`, text: `Fact ${i}` })
      },
    })
    await openTopic('Carbocation stability')
    await openSection('Extracted')
    expect(texts('Extracted')).toHaveLength(NOTES_SHOWN)
    fireEvent.click(screen.getByRole('button', { name: 'Show all (8)' }))
    expect(texts('Extracted')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('a subtopic name opens its own detail; back goes up one level, then to the topics', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await screen.findByRole('list', { name: 'Subtopics' })
    fireEvent.click(nameButton('Carbocation rearrangements'))
    expect(await screen.findByRole('heading', { name: 'Carbocation rearrangements' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /lock this topic/i })).toBeNull()
    expect(screen.getByText(EMPTY_FLAGS)).toBeTruthy()
    fireEvent.click(nameButton('Hydride shifts'))
    expect(await screen.findByRole('heading', { name: 'Hydride shifts' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Subtopics' })).toBeNull()
    await openSection('Your notes')
    expect(texts('Your notes')).toEqual([expect.stringMatching(/1,2-hydride shift/)])
    expect(screen.getByRole('list', { name: 'Your notes' }).textContent).toMatch(
      /Chemistry LibreTexts/,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to Carbocation rearrangements' }))
    expect(await screen.findByRole('heading', { name: 'Carbocation rearrangements' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Carbocation stability' }))
    expect(await screen.findByRole('heading', { name: 'Carbocation stability' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lock this topic' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
  })

  it('Esc goes up one level at a time, then back to the topics', async () => {
    const r = renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await screen.findByRole('list', { name: 'Subtopics' })
    fireEvent.click(nameButton('Hyperconjugation'))
    expect(await screen.findByRole('heading', { name: 'Hyperconjugation' })).toBeTruthy()
    await openSection('Your notes')
    expect(texts('Your notes')).toEqual([expect.stringMatching(/C–H bond/)])
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(await screen.findByRole('heading', { name: 'Carbocation stability' })).toBeTruthy()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
    expect(r.calls('window.close')).toEqual([])
  })

  it('what is open stays open while the panel is open, and closes when it hides', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await openSection('Your notes')
    const list = await screen.findByRole('list', { name: 'Your notes' })
    fireEvent.click(within(list).getAllByRole('button', { expanded: false })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
    await openTopic('Carbocation stability')
    const again = await screen.findByRole('list', { name: 'Your notes' })
    expect(within(again).getAllByRole('button', { expanded: true })).toHaveLength(1)
    act(() => forgetOpened()) // the panel hid
    expect(screen.queryByRole('list', { name: 'Your notes' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Your notes, 1' }).getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('a very long unbroken string wraps inside the panel instead of widening it', async () => {
    const long = `https://example.org/${'a'.repeat(400)}`
    const word = 'Pneumono'.repeat(40)
    renderPanel({
      prepare: (db) => {
        addDemoSubtopics(db)
        const note = db.notes.find((n) => n.id === 'note_cc2') as Note
        note.text = `${word} ${long}`
        note.source = { ...note.source, title: long }
      },
    })
    await openTopic('Carbocation stability')
    await openSection('Your notes')
    const list = await screen.findByRole('list', { name: 'Your notes' })
    const body = within(list).getAllByRole('button', { expanded: false })[0] as HTMLElement
    const text = body.querySelector('.pn-note__text') as HTMLElement
    expect(text.textContent).toContain(word)
    // Closed: one line with an ellipsis. Open: the whole text, wrapped anywhere.
    expect(rule(detailCss, '.pn-note__text')).toMatch(/text-overflow:\s*ellipsis/)
    fireEvent.click(body)
    expect(body.closest('li')?.hasAttribute('data-open')).toBe(true)
    const open = rule(detailCss, '.pn-note[data-open] .pn-note__text')
    expect(open).toMatch(/white-space:\s*normal/)
    expect(open).toMatch(/overflow-wrap:\s*anywhere/)
    expect(open).toMatch(/word-break:\s*break-word/)
    expect(rule(detailCss, '.pn-note .pn-flag__meta')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule(detailCss, '.pn-subtopics .pn-topic__name')).toMatch(/overflow-wrap:\s*anywhere/)
    // Flex and grid children may shrink below their content; the body never scrolls sideways.
    expect(rule(panelCss, '.pn-flags')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(rule(panelCss, '.pn-flag')).toMatch(/min-width:\s*0/)
    expect(rule(detailCss, '.pn-note__body')).toMatch(/min-width:\s*0/)
    expect(rule(panelCss, '.pn-body')).toMatch(/overflow-x:\s*hidden/)
    expect(rule(panelCss, '.pn-card')).toMatch(/overflow:\s*hidden/)
    const name = rule(panelCss, '.pn-detail__name')
    expect(name).toMatch(/overflow-wrap:\s*anywhere/)
    expect(name).not.toMatch(/nowrap/)
    expect(rule(panelCss, '.pn-step__title')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('a topic without subtopics has no tree', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Plate tectonics')
    expect(await screen.findByRole('button', { name: /^Your notes, / })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Subtopics' })).toBeNull()
  })
})
