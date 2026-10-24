/** Settings: every section renders against the mock, plus the switches and lists that write. */
import { useToasts } from '@renderer/design-system'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route } from 'wouter'
import { SettingsPage } from './SettingsPage'
import { SETTINGS_SECTIONS } from './sections'

const page = <Route path="/settings/:section" component={SettingsPage} />

beforeEach(() => useToasts.setState({ toasts: [] }))

describe('SettingsPage', () => {
  it.each(SETTINGS_SECTIONS.map((s) => [s.id, s.label]))(
    'renders the %s section',
    async (id, label) => {
      renderWithApp(page, { route: `/settings/${id}` })
      const nav = screen.getByRole('navigation', { name: 'Settings sections' })
      const current = nav.querySelector('[aria-current="page"]')
      expect(current?.textContent).toBe(label)
      expect(await screen.findAllByRole('heading', { level: 2 })).not.toHaveLength(0)
    },
  )

  it('redirects an unknown section to General', async () => {
    const r = renderWithApp(page, { route: '/settings/nope' })
    await waitFor(() => expect(r.history.at(-1)).toBe('/settings/general'))
  })

  it('turns capture off through capture.setEnabled', async () => {
    const r = renderWithApp(page, { route: '/settings/capture' })
    const sw = await screen.findByRole('switch', { name: 'Screen capture' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    await waitFor(() => expect(r.api.db.settings.captureEnabled).toBe(false))
  })

  it('offers "Every second" capture, the default', async () => {
    const r = renderWithApp(page, { route: '/settings/capture' })
    expect(await screen.findByText('Every second')).toBeTruthy()
    expect(r.api.db.settings.cadence.activeMs).toBe(1000)
  })

  it('adds an excluded site from a pasted link', async () => {
    const r = renderWithApp(page, { route: '/settings/capture' })
    const input = await screen.findByPlaceholderText('e.g. mail.google.com')
    fireEvent.change(input, { target: { value: 'https://www.reddit.com/r/chemistry' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() => expect(r.api.db.settings.excludedHosts).toContain('reddit.com'))
  })

  it('shows live permission status and waits for macOS after Open System Settings', async () => {
    renderWithApp(page, { route: '/settings/capture' })
    expect(await screen.findByText('Granted')).toBeTruthy()
    expect(screen.getByText('Off — Dumbledore can’t read PDFs, slides or video')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Open System Settings for Screen Recording' }).textContent,
    ).toBe('Turn on')
    fireEvent.click(
      screen.getByRole('button', { name: 'Open System Settings for Screen Recording' }),
    )
    expect(await screen.findByText('Waiting for macOS…')).toBeTruthy()
  })

  it('saves orb switches', async () => {
    const r = renderWithApp(page, { route: '/settings/orb' })
    fireEvent.click(await screen.findByRole('switch', { name: 'Hide into the edge' }))
    await waitFor(() => expect(r.api.db.settings.orb.hideIntoEdge).toBe(true))
  })

  it('offers right ⌘ when right ⌥ may clash with Goldfish', async () => {
    const r = renderWithApp(page, { route: '/settings/shortcuts' })
    fireEvent.click(await screen.findByRole('button', { name: 'Use right ⌘ instead' }))
    await waitFor(() => expect(r.api.db.settings.shortcut.key).toBe('rightCommand'))
  })

  it('teaches the key: tap = the prompt, hold = the prompt box, double-tap = chat', async () => {
    renderWithApp(page, { route: '/settings/shortcuts' })
    const list = await screen.findByRole('list', { name: 'Dumbledore key' })
    expect(list.textContent).toContain('The prompt: studied last · next step · rewrite yourstap⌥')
    expect(list.textContent).toContain('Tell Dumbledore what you want, it writes the prompthold⌥')
    expect(list.textContent).toContain('Chat with Dumbledoredouble-tap⌥')
    expect(
      screen.getByText(
        /Hold: tell Dumbledore what you want, it writes the prompt\. Double-tap: chat with Dumbledore\./,
      ),
    ).toBeTruthy()
  })

  it('shows a loading state while settings load', () => {
    renderWithApp(page, { route: '/settings/general', mock: { latencyMs: 60_000 } })
    expect(screen.getByRole('status').textContent).toContain('Loading your settings…')
  })
})
