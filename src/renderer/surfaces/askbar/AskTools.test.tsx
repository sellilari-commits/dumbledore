/**
 * The tool-using chat in the Ask bar: receipt rows with Undo under a reply (the only UI there: no
 * chips or buttons, a delete is a plain question), and links in replies (a web search's sources)
 * that open only when clicked.
 */
import type { CoachAction } from '@shared/domain'
import type { InvokeChannel } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvokeHandlers } from '../overlay/lib/localApi'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar } from './AskBar'
import { isOpenable, withoutReceiptLines } from './AskLog'

const RENAME: CoachAction = {
  type: 'undo_save',
  saveId: 'undo_1',
  label: 'Renamed “Causal graphs” → “DAGs”',
}
const STEP: CoachAction = {
  type: 'undo_save',
  saveId: 'undo_2',
  label: 'Marked step 3 “Backdoor criterion” done',
}
const OPENED: CoachAction = { type: 'undo_save', saveId: '', label: 'Opened ChatGPT and pasted' }

function askApi(result: AskResult, extra: InvokeHandlers = {}) {
  return fakeApi(
    {
      'chat.history': () => [],
      'subjects.list': () => [],
      'ask.submit': () => result,
      'coach.runAction': () => undefined,
      'window.close': () => undefined,
      'window.setSize': () => undefined,
      ...extra,
    },
    'askbar',
  )
}

const reply = (text: string, actions: CoachAction[]): AskResult => ({
  reply: text,
  actions,
  pasted: false,
})
const flush = () => act(async () => {})
const callsTo = (local: ReturnType<typeof askApi>, channel: InvokeChannel) =>
  local.calls.filter((c) => c.channel === channel).map((c) => c.payload)

async function ask(local: ReturnType<typeof askApi>, text = 'rename it and mark step 3 done') {
  render(<AskBar api={local.api} />)
  const input = screen.getByRole('textbox', { name: 'Ask Dumbledore' })
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await flush()
}

const receipts = () => screen.getByRole('list', { name: 'What Dumbledore changed' })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Ask bar receipts', () => {
  it('shows each labelled write as its own row with Undo, never as a chip', async () => {
    const local = askApi(reply('Done, step 4 is next.', [RENAME, STEP]))
    await ask(local)
    const rows = within(receipts()).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('.ask__receipt-line')?.textContent)).toEqual([
      RENAME.type === 'undo_save' ? RENAME.label : '',
      STEP.type === 'undo_save' ? STEP.label : '',
    ])
    expect(rows.every((r) => within(r).getByRole('button', { name: /^Undo: / }))).toBe(true)
    // No chips at all: no "Undo" chip, no "Save to subject", no "Open subject".
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(document.querySelector('.ask__chip')).toBeNull()
    expect(
      screen
        .getAllByRole('button')
        .every((b) =>
          /^(Undo: |New chat|Send|Close)/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
        ),
    ).toBe(true)
  })

  it('Undo runs undo_save in place and the row reads Undone', async () => {
    const local = askApi(reply('Done.', [RENAME, STEP]))
    await ask(local)
    fireEvent.click(
      screen.getByRole('button', { name: `Undo: ${(RENAME as { label: string }).label}` }),
    )
    await flush()
    expect(callsTo(local, 'coach.runAction')).toEqual([RENAME])
    expect(callsTo(local, 'window.close')).toEqual([])
    const [first, second] = within(receipts()).getAllByRole('listitem')
    expect(first?.getAttribute('data-state')).toBe('undone')
    expect(first && within(first).getByText('Undone')).toBeTruthy()
    expect(first && within(first).queryByRole('button')).toBeNull()
    expect(second?.getAttribute('data-state')).toBe('idle')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed Undo shows quietly in its row, not as the error line, and can be tried again', async () => {
    const local = askApi(reply('Done.', [RENAME]), {
      'coach.runAction': () => Promise.reject(new Error('That can no longer be undone.')),
    })
    await ask(local)
    const undo = screen.getByRole('button', { name: /^Undo: / })
    fireEvent.click(undo)
    await flush()
    const row = within(receipts()).getByRole('listitem')
    expect(row.getAttribute('data-state')).toBe('failed')
    expect(within(row).getByRole('status').textContent).toBe('That can no longer be undone.')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Undo: / }))
    await flush()
    expect(callsTo(local, 'coach.runAction')).toHaveLength(2)
  })

  it('leaves a reply line out when it only repeats a receipt row', async () => {
    const label = (RENAME as { label: string }).label
    const local = askApi(reply(`Done.\n\n${label}`, [RENAME]))
    await ask(local)
    expect(screen.getAllByText(label)).toHaveLength(1)
    expect(withoutReceiptLines(`Done.\n\n- ${label}\n\nNext: step 4.`, [RENAME])).toBe(
      'Done.\n\nNext: step 4.',
    )
    expect(withoutReceiptLines(`Kept.\n${label}`, [])).toBe(`Kept.\n${label}`)
  })

  it('a receipt without Undo is a plain row (Opened ChatGPT and pasted)', async () => {
    const local = askApi(reply('It’s in ChatGPT: read it, then send.', [OPENED]))
    await ask(local, 'write me a prompt about colliders')
    const row = within(receipts()).getByRole('listitem')
    expect(row.textContent).toContain('Opened ChatGPT and pasted')
    expect(within(row).queryByRole('button')).toBeNull()
  })
})

describe('Ask bar delete: a plain question, no confirmation chip', () => {
  it('shows the question as text and no button', async () => {
    const question = 'Delete the note “Colliders open paths” from Statistics? Say yes to delete it.'
    const local = askApi(reply(question, []))
    await ask(local, 'delete the colliders note')
    expect(screen.getByText(question)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(document.querySelector('.ask__chip')).toBeNull()
  })
})

describe('Ask bar links', () => {
  const SOURCES =
    'A backdoor path starts with an arrow into the treatment.\n\nSources: [What If](https://example.org/what-if) · [Book of Why](https://example.org/why)'

  it('renders sources as links that open only on a click, in the default browser', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const before = window.location.href
    const local = askApi(reply(SOURCES, []))
    await ask(local, 'look up backdoor paths')
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.org/what-if',
      'https://example.org/why',
    ])
    // target=_blank: main's window open handler hands it to shell.openExternal.
    expect(links.every((a) => a.getAttribute('target') === '_blank')).toBe(true)
    expect(links.every((a) => a.getAttribute('rel') === 'noopener noreferrer')).toBe(true)
    expect(links[0]?.closest('p')?.className).toBe('ask__sources')
    // Nothing opened by showing the reply.
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe(before)
    const acted = () =>
      local.calls.map((c) => c.channel).filter((c) => c === 'coach.runAction' || /open/i.test(c))
    expect(acted()).toEqual([])
    // A click is left to the anchor (the window's open handler); the page itself opens nothing.
    fireEvent.click(links[0] as HTMLElement)
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe(before)
    expect(acted()).toEqual([])
  })

  it('only http(s) and mailto are links', async () => {
    const local = askApi(
      reply('[bad](javascript:alert(1)) [file](file:///etc/hosts) [mail](mailto:a@b.c)', []),
    )
    await ask(local, 'links')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['mail'])
    expect(screen.getByText('bad').tagName).toBe('SPAN')
    expect(isOpenable('https://x.org')).toBe(true)
    expect(isOpenable('http://x.org')).toBe(true)
    expect(isOpenable('/local')).toBe(false)
    expect(isOpenable(undefined)).toBe(false)
  })
})
