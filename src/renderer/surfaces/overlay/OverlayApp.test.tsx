import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverlayApp } from './OverlayApp'
import { overlayApi, sent, sentTypes, state } from './testing/fakeApi'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function mount(scene: Parameters<typeof state>[0], displayId: number | null = null) {
  const local = overlayApi(state(scene))
  const view = render(<OverlayApp api={local.api} displayId={displayId} />)
  if (displayId === null || displayId === 1) await screen.findByTestId('orb')
  return { local, view }
}

const face = () => screen.getByRole('button', { name: /^Dumbledore/ })
const press = (el: Element, x = 0, y = 0) =>
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x, clientY: y })
const move = (el: Element, x: number, y: number) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y })
const release = (el: Element, x = 0, y = 0) =>
  fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: x, clientY: y })

describe('display filter', () => {
  it('renders nothing when the state belongs to another display', async () => {
    const local = overlayApi(state('idle'))
    const { container } = render(<OverlayApp api={local.api} displayId={2} />)
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('renders for its own display and follows overlay.changed', async () => {
    const { local } = await mount('idle', 1)
    expect(screen.queryByTestId('orb-thinking')).toBeNull()
    act(() => local.emit('overlay.changed', state('thinking')))
    expect(screen.queryByTestId('orb-thinking')).not.toBeNull()
    act(() => local.emit('overlay.changed', { ...state('idle'), displayId: 7 }))
    expect(screen.queryByTestId('orb')).toBeNull()
  })
})

describe('orb states', () => {
  it('draws pause bars, the session ring, the dot and the docked size', async () => {
    const { local } = await mount('paused')
    expect(screen.queryByTestId('orb-paused')).not.toBeNull()
    act(() => local.emit('overlay.changed', state('session')))
    expect(screen.queryByTestId('orb-ring')).not.toBeNull()
    act(() => local.emit('overlay.changed', state('attention')))
    expect(screen.getByTestId('orb-dot').dataset.color).toBe('orange')
    act(() => local.emit('overlay.changed', state('docked')))
    const orb = screen.getByTestId('orb')
    expect([orb.style.width, orb.style.height]).toEqual(['28px', '28px'])
  })

  it('positions the orb by its centre', async () => {
    await mount('idle')
    const { x, y } = state('idle').orb
    expect(screen.getByTestId('orb').style.transform).toBe(
      `translate3d(${x - 20}px, ${y - 20}px, 0)`,
    )
  })
})

describe('orb gestures', () => {
  it('click → orbClick', async () => {
    const { local } = await mount('idle')
    press(face())
    release(face())
    expect(sentTypes(local)).toEqual(['orbClick'])
  })

  it('press ≥ 500 ms → orbLongPress, and no click', async () => {
    const { local } = await mount('idle')
    vi.useFakeTimers()
    press(face())
    act(() => vi.advanceTimersByTime(520))
    release(face())
    expect(sentTypes(local)).toEqual(['orbLongPress'])
  })

  it('right-click → orbContextMenu', async () => {
    const { local } = await mount('idle')
    fireEvent.contextMenu(face())
    expect(sentTypes(local)).toEqual(['orbContextMenu'])
  })

  it('drag → orbDrag updates, then done with the drop point', async () => {
    const { local } = await mount('idle')
    const { x, y } = state('idle').orb
    press(face(), 500, 300)
    move(face(), 502, 301) // under the threshold: still a press
    move(face(), 400, 350)
    expect(screen.getByTestId('orb').style.transform).toBe(
      `translate3d(${x - 100 - 20}px, ${y + 50 - 20}px, 0)`,
    )
    release(face(), 380, 360)
    const drags = sent(local).filter((a) => a.type === 'orbDrag')
    expect(drags[0]).toEqual({ type: 'orbDrag', x: x - 100, y: y + 50, done: false })
    expect(drags.at(-1)).toEqual({ type: 'orbDrag', x: x - 100, y: y + 50, done: true })
    expect(sentTypes(local)).not.toContain('orbClick')
  })

  it('keeps the dragged orb until the drop when main moves it to another display', async () => {
    const { local } = await mount('idle', 1)
    press(face(), 500, 300)
    move(face(), 400, 300)
    act(() => local.emit('overlay.changed', { ...state('idle'), displayId: 2 }))
    expect(screen.queryByTestId('orb')).not.toBeNull()
    release(face(), 400, 300)
    expect(sent(local).at(-1)).toMatchObject({ type: 'orbDrag', done: true })
    expect(screen.queryByTestId('orb')).toBeNull()
  })

  it('keyboard activation clicks too', async () => {
    const { local } = await mount('idle')
    fireEvent.click(face(), { detail: 0 })
    expect(sentTypes(local)).toEqual(['orbClick'])
  })
})

describe('satellites', () => {
  it('only the orb on the screen edge: no Study pill when an AI chat is open', async () => {
    await mount('pill')
    expect(screen.queryByTestId('study-pill')).toBeNull()
    expect(screen.queryByRole('button', { name: /Study/ })).toBeNull()
  })

  it('suggestion chip → chipClick, with the prompt preview', async () => {
    const { local } = await mount('docked')
    const chip = screen.getByTestId('suggestion-chip')
    expect(chip.textContent).toBe('Explain carbocation stability like I am new to…⌥')
    fireEvent.click(chip)
    expect(sentTypes(local)).toEqual(['chipClick'])
  })

  it('improve chip reads "Rewrite prompt · ⌥"', async () => {
    await mount('improve')
    expect(screen.getByTestId('suggestion-chip').textContent).toBe('Rewrite prompt·⌥')
  })

  it('one square under the orb: the timer, never Next or Quiz', async () => {
    const { local } = await mount('session')
    expect(screen.queryByTestId('side-next')).toBeNull()
    expect(screen.getAllByTestId('timer')).toHaveLength(1)
    act(() => local.emit('overlay.changed', state('checkpoint')))
    expect(screen.queryByTestId('side-quiz')).toBeNull()
  })

  it('timer square: a click opens the length chooser, a preset starts that length', async () => {
    const { local } = await mount('idle')
    const timer = screen.getByTestId('timer')
    expect(timer.getAttribute('aria-label')).toBe('Set a timer')
    expect(screen.queryByTestId('timer-chooser')).toBeNull()
    fireEvent.click(timer, { detail: 0 })
    const chooser = screen.getByTestId('timer-chooser')
    expect(chooser.textContent).toContain('5 min15 min25 min45 min60 min')
    expect(screen.getByRole('button', { name: '25 min' }).getAttribute('data-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '45 min' }))
    expect(sent(local).filter((a) => a.type === 'timerStart')).toEqual([
      { type: 'timerStart', minutes: 45 },
    ])
    expect(screen.queryByTestId('timer-chooser')).toBeNull()
  })

  it('timer chooser: custom length steps within 1–180 and starts it', async () => {
    const { local } = await mount('idle')
    fireEvent.click(screen.getByTestId('timer'), { detail: 0 })
    const custom = screen.getByTestId('timer-custom')
    expect(custom.textContent).toBe('25 min')
    fireEvent.click(screen.getByRole('button', { name: 'Longer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Longer' }))
    expect(custom.textContent).toBe('35 min')
    for (let i = 0; i < 60; i++) fireEvent.click(screen.getByRole('button', { name: 'Shorter' }))
    expect(custom.textContent).toBe('1 min')
    expect(screen.getByRole('button', { name: 'Shorter' })).toHaveProperty('disabled', true)
    fireEvent.click(custom)
    expect(sent(local).filter((a) => a.type === 'timerStart')).toEqual([
      { type: 'timerStart', minutes: 1 },
    ])
  })

  it('timer square: right click starts the last length; running shows minutes left', async () => {
    const { local } = await mount('idle')
    fireEvent.contextMenu(screen.getByTestId('timer'))
    expect(sent(local).filter((a) => a.type === 'timerStart')).toEqual([
      { type: 'timerStart', minutes: 25 },
    ])
    act(() => local.emit('overlay.changed', state('timer')))
    const running = screen.getByTestId('timer')
    expect(running.textContent).toContain('18')
    expect(running.getAttribute('aria-label')).toBe('18 min left · click to change')
  })

  it('running timer: a click opens −5 / −1 / +1 / +5 and Stop; right click stops at once', async () => {
    const { local } = await mount('timer')
    fireEvent.click(screen.getByTestId('timer'), { detail: 0 })
    expect(screen.getByTestId('timer-left').textContent).toBe('18 min left')
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 min' }))
    fireEvent.click(screen.getByRole('button', { name: 'Take off 1 min' }))
    expect(sent(local).filter((a) => a.type === 'timerAdjust')).toEqual([
      { type: 'timerAdjust', deltaMinutes: 5 },
      { type: 'timerAdjust', deltaMinutes: -1 },
    ])
    expect(sentTypes(local)).not.toContain('timerClick')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(sentTypes(local)).toContain('timerClick')
    expect(screen.queryByTestId('timer-running')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('timer'))
    expect(sentTypes(local).filter((t) => t === 'timerClick')).toHaveLength(2)
  })

  it('running timer chooser closes after 5 s without a click', async () => {
    await mount('timer')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('timer'), { detail: 0 })
    expect(screen.getByTestId('timer-running')).toBeTruthy()
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 min' }))
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.getByTestId('timer-running')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1100))
    expect(screen.queryByTestId('timer-running')).toBeNull()
  })

  it('hides the timer square while docked beside a chat box', async () => {
    await mount('docked')
    expect(screen.queryByTestId('timer')).toBeNull()
  })
})

describe('hit areas', () => {
  it('reports hover only when entering and leaving the hit areas', async () => {
    const { local } = await mount('improve')
    fireEvent.pointerMove(document.body)
    fireEvent.pointerMove(face())
    fireEvent.pointerMove(screen.getByTestId('suggestion-chip'))
    fireEvent.pointerMove(document.body)
    const hovers = sent(local).filter((a) => a.type === 'hover')
    expect(hovers).toEqual([
      { type: 'hover', inside: true },
      { type: 'hover', inside: false },
    ])
  })
})

describe('hit areas when shapes change', () => {
  it('hands clicks back when the hovered shape disappears under a still pointer', async () => {
    const { local } = await mount('improve')
    fireEvent.pointerMove(screen.getByTestId('suggestion-chip'), { clientX: 5, clientY: 5 })
    // jsdom has no layout: stand in for hit testing at the pointer.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => document.body,
    })
    try {
      act(() => local.emit('overlay.changed', state('idle')))
      await act(async () => {})
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
    const hovers = sent(local).filter((a) => a.type === 'hover')
    expect(hovers.at(-1)).toEqual({ type: 'hover', inside: false })
  })
})

describe('orb hover', () => {
  it('shows no text when the pointer rests on the orb', async () => {
    await mount('idle')
    vi.useFakeTimers()
    fireEvent.pointerEnter(screen.getByTestId('orb'))
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
