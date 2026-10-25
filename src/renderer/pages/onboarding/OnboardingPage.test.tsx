/** Onboarding: the five steps end to end against the mock, plus the AI and key-lesson branches. */
import { useToasts } from '@renderer/design-system'
import { renderWithApp } from '@renderer/lib/test-utils'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingPage } from './OnboardingPage'

const start = (opts: Parameters<typeof renderWithApp>[1] = {}) =>
  renderWithApp(<OnboardingPage />, { route: '/onboarding', scenario: 'onboarding', ...opts })

const openAt = (step: string) => window.history.replaceState({}, '', `/?step=${step}`)
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const title = (name: string) => screen.findByRole('heading', { level: 1, name })

beforeEach(() => useToasts.setState({ toasts: [] }))
afterEach(() => window.history.replaceState({}, '', '/'))

describe('OnboardingPage', () => {
  it('walks welcome → how it works → permissions → AI → subjects → key → done and saves onboardingDone', async () => {
    const r = start()
    await title('Meet Dumbledore')
    click('Get started')

    await title('How Dumbledore works')
    click('Set it up')

    await title('Let Dumbledore see your screen')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByText('So Dumbledore can read PDFs, slides and video.')).toBeTruthy()
    r.api.db.appState.permissions.accessibility = true
    await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy(), { timeout: 2500 })
    // Screen Recording is required too: Continue waits for it.
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    r.api.db.appState.permissions.screenRecording = true
    await waitFor(() => expect(screen.getAllByText('Granted')).toHaveLength(2), { timeout: 2500 })
    click('Continue')

    await title('Your AI is ready')
    expect(await screen.findByText('Using key from Hugo project · 420 ms')).toBeTruthy()
    click('Continue')

    await title('What are you studying?')
    fireEvent.change(screen.getByLabelText('Subject name'), {
      target: { value: 'Organic Chemistry' },
    })
    fireEvent.change(screen.getByLabelText('Deadline (optional)'), {
      target: { value: '2026-12-12' },
    })
    click('Add')
    expect(await screen.findByText('Organic Chemistry')).toBeTruthy()
    expect(screen.getByText('Dec 12')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('A few lines about you'), {
      target: { value: 'First-year chemistry student.' },
    })
    click('Continue')

    await title('Meet the Dumbledore key')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(r.api.db.profile.aboutMe).toBe('First-year chemistry student.')
    act(() => r.api.pressKey('tap'))
    expect(
      await screen.findByText(
        /That’s it — tap right ⌥ in an AI chat for a prompt on what you studied last/,
      ),
    ).toBeTruthy()
    click('Continue')

    await title('You’re all set')
    expect(screen.getByText('1 subject to start with.')).toBeTruthy()
    expect(screen.getByText('You know right ⌥.')).toBeTruthy()
    click('Start studying')
    await waitFor(() => expect(r.history.at(-1)).toBe('/home'))
    expect(r.api.db.settings.onboardingDone).toBe(true)
  })

  it('asks for a Gemini key when none is found, and is ready once one is saved', async () => {
    openAt('ai')
    const r = start({ mock: { geminiEnvKey: false } })
    await title('Connect an AI')
    expect(screen.getByRole('button', { name: 'Set up later' })).toBeTruthy()
    const input = await screen.findByLabelText('Gemini API key')
    fireEvent.change(input, { target: { value: 'AIzaSyD-a-long-enough-test-key' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await title('Your AI is ready')
    expect(await screen.findByText('Connected · 420 ms')).toBeTruthy()
    expect(r.api.db.settings.ai.geminiKeySet).toBe(true)
  })

  it('coaches a wrong key and a hold, then recognises a real tap from the keyboard', async () => {
    openAt('key')
    const r = start()
    await title('Meet the Dumbledore key')
    act(() => r.api.pressKey('tap', 'leftOption'))
    expect(await screen.findByText('That’s left ⌥ — tap right ⌥ instead.')).toBeTruthy()
    act(() => r.api.pressKey('holdStart'))
    expect(
      await screen.findByText(/That’s a hold — on a page or an AI answer it marks/),
    ).toBeTruthy()
    act(() => r.api.pressKey('holdEnd'))
    // A real press in this window: keydown + keyup of the right Option key.
    fireEvent.keyDown(window, { code: 'AltRight', key: 'Alt' })
    fireEvent.keyUp(window, { code: 'AltRight', key: 'Alt' })
    expect(await screen.findByText(/That’s it/)).toBeTruthy()
    act(() => r.api.pressKey('holdStart'))
    act(() => r.api.pressKey('holdEnd'))
    expect(
      await screen.findByText(/That’s a hold: on a page or an AI answer it marks what to read/),
    ).toBeTruthy()
    act(() => r.api.pressKey('doubleTap'))
    expect(await screen.findByText(/it opens the chat with Dumbledore/)).toBeTruthy()
    expect(
      screen.getByText(/^On an article, a PDF or the AI's answer: what to read for your gaps\./),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('offers right ⌘ when right ⌥ is taken, and then teaches that key', async () => {
    openAt('key')
    const r = start()
    await title('Meet the Dumbledore key')
    click('Nothing happens, or another app reacts?')
    click('Use right ⌘ instead')
    expect(await screen.findByText('Waiting for right ⌘…')).toBeTruthy()
    expect(r.api.db.settings.shortcut.key).toBe('rightCommand')
    act(() => r.api.pressKey('tap', 'rightCommand'))
    expect(await screen.findByText(/That’s it — tap right ⌘/)).toBeTruthy()
  })

  it('lets you skip setup from any step', async () => {
    openAt('permissions')
    const r = start()
    await title('Let Dumbledore see your screen')
    click('Skip setup')
    await waitFor(() => expect(r.history.at(-1)).toBe('/home'))
    expect(r.api.db.settings.onboardingDone).toBe(true)
  })

  it('is honest on the final screen about what was skipped', async () => {
    openAt('done')
    start({ mock: { geminiEnvKey: false } })
    await title('You’re all set')
    expect(
      await screen.findByText('Turn on Accessibility later in Settings → Capture.'),
    ).toBeTruthy()
    expect(
      await screen.findByText('Free fallbacks for now — add a key in Settings → AI.'),
    ).toBeTruthy()
    expect(screen.getByText('Dumbledore will suggest some from what you read.')).toBeTruthy()
  })
})
