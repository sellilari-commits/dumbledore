import { describe, expect, it, vi } from 'vitest'
import { GlobalShortcuts, type ShortcutRegistry, toAccelerator } from './shortcuts'

vi.mock('electron', () => ({ globalShortcut: {} }))

class FakeRegistry implements ShortcutRegistry {
  readonly keys = new Map<string, () => void>()
  /** Accelerators another app holds. */
  readonly taken = new Set<string>()

  register(accelerator: string, callback: () => void): boolean {
    if (this.taken.has(accelerator) || this.keys.has(accelerator)) return false
    this.keys.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.keys.delete(accelerator)
  }

  unregisterAll(): void {
    this.keys.clear()
  }

  press(accelerator: string): void {
    this.keys.get(accelerator)?.()
  }
}

function setup() {
  const calls: string[] = []
  const registry = new FakeRegistry()
  const shortcuts = new GlobalShortcuts(
    {
      tap: () => void calls.push('tap'),
      toggleCapture: () => void calls.push('capture'),
      openApp: () => void calls.push('app'),
    },
    registry,
  )
  return { calls, registry, shortcuts }
}

describe('toAccelerator', () => {
  it('turns settings chords into Electron accelerators', () => {
    expect(toAccelerator('Control+Option+D')).toBe('Control+Alt+D')
    expect(toAccelerator(' ⌘ + ⌥ + K ')).toBe('Command+Alt+K')
    expect(toAccelerator('Control+Alt+Command+P')).toBe('Control+Alt+Command+P')
  })
})

describe('GlobalShortcuts', () => {
  it('registers the two global chords and the fallback trigger chord', () => {
    const { calls, registry, shortcuts } = setup()
    shortcuts.start('Control+Option+D')
    expect([...registry.keys.keys()].sort()).toEqual([
      'Control+Alt+Command+D',
      'Control+Alt+Command+P',
      'Control+Alt+D',
    ])
    registry.press('Control+Alt+D')
    registry.press('Control+Alt+Command+P')
    registry.press('Control+Alt+Command+D')
    expect(calls).toEqual(['tap', 'capture', 'app'])
    shortcuts.setFallback('Control+Option+K')
    expect(registry.keys.has('Control+Alt+D')).toBe(false)
    expect(registry.keys.has('Control+Alt+K')).toBe(true)
  })

  it('takes Esc only while work is pending', () => {
    const { registry, shortcuts } = setup()
    const cancel = vi.fn()
    shortcuts.setEscape(true, cancel)
    registry.press('Escape')
    expect(cancel).toHaveBeenCalledOnce()
    shortcuts.setEscape(false, cancel)
    expect(registry.keys.has('Escape')).toBe(false)
  })

  it('grabs 1–4, Enter and Esc while the quiz card is open and forwards them', () => {
    const { registry, shortcuts } = setup()
    const forwarded: string[] = []
    shortcuts.setQuizKeys(true, (key) => void forwarded.push(key))
    for (const key of ['2', 'Return', 'Escape']) registry.press(key)
    expect(forwarded).toEqual(['2', 'Return', 'Escape'])
    shortcuts.setQuizKeys(false, () => undefined)
    expect([...registry.keys.keys()]).toEqual([])
  })

  it('shares Esc: pending work is cancelled first, the quiz closes once nothing is pending', () => {
    const { registry, shortcuts } = setup()
    const order: string[] = []
    shortcuts.setQuizKeys(true, (key) => void order.push(`quiz:${key}`))
    shortcuts.setEscape(true, () => void order.push('cancel'))
    registry.press('Escape')
    shortcuts.setEscape(false, () => undefined)
    expect(registry.keys.has('Escape')).toBe(true)
    registry.press('Escape')
    shortcuts.setQuizKeys(false, () => undefined)
    expect(registry.keys.has('Escape')).toBe(false)
    expect(order).toEqual(['cancel', 'quiz:Escape'])
  })

  it('retries Esc when another app held it, and forgets everything on stop', () => {
    const { registry, shortcuts } = setup()
    registry.taken.add('Escape')
    shortcuts.setEscape(true, () => undefined)
    expect(registry.keys.has('Escape')).toBe(false)
    registry.taken.clear()
    shortcuts.setQuizKeys(true, () => undefined)
    expect(registry.keys.has('Escape')).toBe(true)
    shortcuts.start('Control+Option+D')
    shortcuts.stop()
    expect(registry.keys.size).toBe(0)
    shortcuts.setQuizKeys(true, () => undefined)
    expect(registry.keys.has('1')).toBe(true)
  })
})
