/** Mock API: keys and provider tests (Gemini first), profile, export, delete-all, key gestures. */
import { describe, expect, it, vi } from 'vitest'
import { createMockApi } from './mock-api'

const api = (opts: Parameters<typeof createMockApi>[0] = {}) =>
  createMockApi({ latencyMs: 0, ...opts })

describe('mock API — AI providers', () => {
  it('passes the Gemini test with the dev env key and no saved key', async () => {
    const a = api()
    expect((await a.invoke('settings.get')).ai.geminiKeySet).toBe(false)
    expect(await a.invoke('providers.test', 'gemini')).toEqual({
      ok: true,
      latencyMs: 420,
      error: null,
    })
  })

  it('asks for a Gemini key when there is no env key, and accepts a saved one', async () => {
    const a = api({ geminiEnvKey: false, scenario: 'onboarding' })
    const before = await a.invoke('providers.test', 'gemini')
    expect(before.ok).toBe(false)
    expect(before.error).toBe('Add a Gemini key first.')
    await a.invoke('secrets.set', { key: 'gemini', value: 'AIzaSyD-a-long-enough-test-key' })
    expect((await a.invoke('settings.get')).ai.geminiKeySet).toBe(true)
    expect((await a.invoke('providers.test', 'gemini')).ok).toBe(true)
  })

  it('rejects a key that is too short to be real', async () => {
    const a = api({ geminiEnvKey: false })
    await a.invoke('secrets.set', { key: 'gemini', value: 'nope' })
    const r = await a.invoke('providers.test', 'gemini')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/rejected/)
  })

  it('keeps Groq and Mistral keys separate', async () => {
    const a = api({ scenario: 'onboarding' })
    expect((await a.invoke('providers.test', 'groq')).error).toBe('Add a Groq key first.')
    await a.invoke('secrets.set', { key: 'mistral', value: 'mistral-key-0123456789' })
    const ai = (await a.invoke('settings.get')).ai
    expect([ai.groqKeySet, ai.mistralKeySet]).toEqual([false, true])
    expect((await a.invoke('providers.test', 'ovh')).ok).toBe(true)
  })
})

describe('mock API — profile and data', () => {
  it('reports no prompt habits on the first day (empty scenario), and demo habits otherwise', async () => {
    const empty = await api({ scenario: 'empty' }).invoke('home.get')
    expect(empty.habits).toEqual({
      promptsSeen: 0,
      withContext: 0,
      withStructure: 0,
      askedToBeQuizzed: 0,
      askedForExamples: 0,
    })
    expect((await api().invoke('home.get')).habits.promptsSeen).toBeGreaterThan(0)
  })

  it('reads and patches the profile', async () => {
    const a = api()
    const before = await a.invoke('profile.get')
    expect(before.level).toBe('University, year 2')
    const after = await a.invoke('profile.update', { level: null, promptLanguage: 'fi' })
    expect(after.level).toBeNull()
    expect(after.promptLanguage).toBe('fi')
    expect(after.aboutMe).toBe(before.aboutMe)
    expect((await a.invoke('profile.get')).promptLanguage).toBe('fi')
  })

  it('exports to a path', async () => {
    const { path } = await api().invoke('data.export')
    expect(path).toMatch(/\/exports\/dumbledore-export-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('deletes everything back to a first run, keeping macOS permissions', async () => {
    const a = api()
    const changed = vi.fn()
    a.on('memory.changed', changed)
    await a.invoke('data.deleteAll', { confirm: true })
    expect(await a.invoke('subjects.list')).toEqual([])
    expect((await a.invoke('profile.get')).aboutMe).toBe('')
    expect((await a.invoke('profile.get')).habits.promptsSeen).toBe(0)
    const settings = await a.invoke('settings.get')
    expect(settings.onboardingDone).toBe(false)
    expect(settings.ai.groqKeySet).toBe(false)
    expect((await a.invoke('app.getState')).permissions.accessibility).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(changed).toHaveBeenCalledWith({ scope: 'subjects', ids: [] })
  })
})

describe('mock API — key gestures', () => {
  it('emits key.gesture for a simulated press, defaulting to the configured key', async () => {
    const a = api()
    const seen = vi.fn()
    a.on('key.gesture', seen)
    a.pressKey()
    a.pressKey('holdStart', 'leftOption')
    await new Promise((r) => setTimeout(r, 0))
    expect(seen.mock.calls.map((c) => c[0])).toEqual([
      { gesture: 'tap', key: 'rightOption' },
      { gesture: 'holdStart', key: 'leftOption' },
    ])
  })
})
