import type { OverlayAction, Toast } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NUDGE, TIP } from '../mock/scenes'
import { ToastStack } from './ToastStack'

const anchor = { left: 100, top: 100, origin: 'right top' }

function mount(toasts: Toast[]) {
  const send = vi.fn<(a: OverlayAction) => void>()
  const view = render(<ToastStack toasts={toasts} anchor={anchor} send={send} />)
  return { send, view }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ToastStack', () => {
  it('shows title, one sentence and up to two buttons', () => {
    mount([{ ...NUDGE, actions: [...NUDGE.actions, { id: 'x', label: 'Extra', primary: false }] }])
    expect(screen.getByText(NUDGE.title)).toBeTruthy()
    expect(screen.getByText(NUDGE.body)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Extra' })).toBeNull()
  })

  it('auto-hides after ttlMs by collapsing into the orb → toastDismiss', () => {
    const { send } = mount([{ ...NUDGE, ttlMs: 1000 }])
    act(() => vi.advanceTimersByTime(999))
    expect(send).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('toast').dataset.leaving).toBe('collapse')
    act(() => vi.advanceTimersByTime(200))
    expect(send).toHaveBeenCalledWith({ type: 'toastDismiss', toastId: NUDGE.id })
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('hovering pauses the countdown and keeps the time left', () => {
    const { send } = mount([{ ...NUDGE, ttlMs: 1000 }])
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerEnter(screen.getByTestId('toast'))
    act(() => vi.advanceTimersByTime(5000))
    expect(send).not.toHaveBeenCalled()
    fireEvent.pointerLeave(screen.getByTestId('toast'))
    act(() => vi.advanceTimersByTime(399))
    expect(send).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1 + 200))
    expect(send).toHaveBeenCalledWith({ type: 'toastDismiss', toastId: NUDGE.id })
  })

  it('× dismisses; a button sends toastAction at once', () => {
    const { send } = mount([NUDGE, TIP])
    const [first] = screen.getAllByRole('button', { name: 'Dismiss' })
    if (!first) throw new Error('no dismiss button')
    fireEvent.click(first)
    act(() => vi.advanceTimersByTime(200))
    expect(send).toHaveBeenCalledWith({ type: 'toastDismiss', toastId: NUDGE.id })
    send.mockClear()
    render(<ToastStack toasts={[NUDGE]} anchor={anchor} send={send} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }))
    expect(send).toHaveBeenCalledWith({ type: 'toastAction', toastId: NUDGE.id, actionId: 'start' })
  })

  it('never auto-hides a sticky toast (ttlMs ≤ 0)', () => {
    const { send } = mount([{ ...TIP, ttlMs: 0 }])
    act(() => vi.advanceTimersByTime(60_000))
    expect(send).not.toHaveBeenCalled()
  })

  it('shows at most three, newest kept', () => {
    const many = [1, 2, 3, 4].map((i) => ({ ...TIP, id: `t${i}`, title: `Tip ${i}` }))
    mount(many)
    expect(screen.getAllByTestId('toast')).toHaveLength(3)
    expect(screen.queryByText('Tip 1')).toBeNull()
  })
})
