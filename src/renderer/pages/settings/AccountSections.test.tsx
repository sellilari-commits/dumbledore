/** Settings → AI providers (Gemini first), About you (profile channels) and Data (export, delete). */
import { useToasts } from '@renderer/design-system'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route } from 'wouter'
import { SettingsPage } from './SettingsPage'

const page = <Route path="/settings/:section" component={SettingsPage} />

beforeEach(() => useToasts.setState({ toasts: [] }))

describe('Settings → AI providers', () => {
  it('lists Gemini first, then Groq, OVHcloud, Mistral and Apple', async () => {
    renderWithApp(page, { route: '/settings/ai' })
    await screen.findByText('Using key from Hugo project · 420 ms')
    const text = document.body.textContent ?? ''
    const order = [
      'Gemini 3.5',
      'Groq',
      'OVHcloud AI Endpoints',
      'Mistral',
      'Apple on-device model',
    ]
    const at = order.map((name) => text.indexOf(name))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('asks for a Gemini key when there is none, and shows Connected once saved', async () => {
    const r = renderWithApp(page, { route: '/settings/ai', mock: { geminiEnvKey: false } })
    const input = await screen.findByLabelText('Gemini API key')
    expect(screen.getByText(/No key yet/)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'AIzaSyD-a-long-enough-test-key' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(await screen.findByText('Connected · 420 ms')).toBeTruthy()
    expect(r.api.db.settings.ai.geminiKeySet).toBe(true)
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy()
  })

  it('shows the error when a saved key is rejected, and re-tests on demand', async () => {
    renderWithApp(page, { route: '/settings/ai', mock: { geminiEnvKey: false } })
    const input = await screen.findByLabelText('Gemini API key')
    fireEvent.change(input, { target: { value: 'short' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect((await screen.findByRole('alert')).textContent).toMatch(/rejected that key/)
    fireEvent.click(screen.getByRole('button', { name: 'Test Gemini' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/rejected/)
  })

  it('tests keyless OVHcloud inline', async () => {
    renderWithApp(page, { route: '/settings/ai' })
    fireEvent.click(await screen.findByRole('button', { name: 'Test OVHcloud' }))
    expect(await screen.findByText('Connected · 880 ms')).toBeTruthy()
  })

  it('shows today’s usage with Gemini rows', async () => {
    renderWithApp(page, { route: '/settings/ai' })
    expect(await screen.findByText('gemini-3.5-flash')).toBeTruthy()
    expect(screen.getAllByText('Gemini').length).toBeGreaterThan(0)
  })

  it('shows an error for usage when the engine does not answer', async () => {
    renderWithApp(page, { route: '/settings/ai', scenario: 'error' })
    expect(await screen.findByText('Couldn’t load today’s usage')).toBeTruthy()
  })
})

describe('Settings → About you', () => {
  it('loads the profile and saves edits through profile.update', async () => {
    const r = renderWithApp(page, { route: '/settings/about' })
    const about = await screen.findByLabelText('About me')
    expect((about as HTMLTextAreaElement).value).toMatch(/Second-year chemistry/)
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '  ' } })
    fireEvent.click(save)
    await waitFor(() => expect(r.api.db.profile.level).toBeNull())
    expect(await screen.findByText('Saved — your next prompts will use it')).toBeTruthy()
  })

  it('discards unsaved changes', async () => {
    renderWithApp(page, { route: '/settings/about' })
    const level = (await screen.findByLabelText('Level')) as HTMLInputElement
    fireEvent.change(level, { target: { value: 'High school' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(level.value).toBe('University, year 2')
  })

  it('shows loading copy while the profile loads', () => {
    renderWithApp(page, { route: '/settings/about', scenario: 'slow' })
    return waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Loading what you told Dumbledore…'),
    )
  })
})

describe('Settings → Data', () => {
  it('exports and shows where the file went', async () => {
    renderWithApp(page, { route: '/settings/data' })
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    const result = await screen.findByText(/dumbledore-export-.*\.json/)
    expect(result.textContent).toMatch(/^~\/Library\/Application Support\/Dumbledore\/exports\//)
  })

  it('deletes everything (exports too) only after confirming, then opens onboarding', async () => {
    const r = renderWithApp(page, { route: '/settings/data' })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete everything…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete everything?')).toBeTruthy()
    expect(within(dialog).getByText('Every export in the exports folder')).toBeTruthy()
    expect(r.api.db.subjects.length).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(r.history.at(-1)).toBe('/onboarding'))
    expect(r.api.db.subjects).toEqual([])
    expect(r.api.db.settings.onboardingDone).toBe(false)
  })

  it('cancelling keeps everything', async () => {
    const r = renderWithApp(page, { route: '/settings/data' })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete everything…' }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(r.api.db.subjects.length).toBeGreaterThan(0)
  })
})
