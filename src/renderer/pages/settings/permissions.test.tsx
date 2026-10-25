import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionControl, STALE_SWITCH_MS } from './permissions'

describe('PermissionControl while waiting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const waitingControl = (onReset = vi.fn()) => {
    render(
      <PermissionControl
        title="Accessibility"
        granted={false}
        waiting
        onOpen={() => undefined}
        onReset={onReset}
      />,
    )
    return onReset
  }

  it('suggests a stale switch only after a while, and resets on request', () => {
    const onReset = waitingControl()
    expect(screen.getByText('Waiting for macOS…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Already on? Reset and ask again' })).toBeNull()
    act(() => vi.advanceTimersByTime(STALE_SWITCH_MS))
    const reset = screen.getByRole('button', { name: 'Already on? Reset and ask again' })
    expect(reset.getAttribute('title')).toMatch(/earlier copy of Dumbledore/)
    fireEvent.click(screen.getByRole('button', { name: 'Already on? Reset and ask again' }))
    expect(onReset).toHaveBeenCalledOnce()
    // A fresh wait: the hint comes back only if the new switch doesn't work either.
    expect(screen.queryByRole('button', { name: 'Already on? Reset and ask again' })).toBeNull()
    act(() => vi.advanceTimersByTime(STALE_SWITCH_MS))
    expect(screen.getByRole('button', { name: 'Already on? Reset and ask again' })).toBeTruthy()
  })

  it('shows Granted once macOS reports the switch', () => {
    render(<PermissionControl title="Accessibility" granted waiting onOpen={() => undefined} />)
    expect(screen.getByText('Granted')).toBeTruthy()
  })
})
