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
  it('Study pill → pillClick', async () => {
    const { local } = await mount('pill')
    fireEvent.click(screen.getByRole('button', { name: /Study, 4 open study questions/ }))
    expect(sentTypes(local)).toEqual(['pillClick'])
  })

  it('suggestion chip → chipClick, with the prompt preview', async () => {
    const { local } = await mount('docked')
    const chip = screen.getByTestId('suggestion-chip')
    expect(chip.textContent).toBe('✨Explain carbocation stability like I am new to…⌥')
    fireEvent.click(chip)
    expect(sentTypes(local)).toEqual(['chipClick'])
  })

  it('improve chip reads "Rewrite prompt · ⌥"', async () => {
    await mount('improve')
    expect(screen.getByTestId('suggestion-chip').textContent).toBe('Rewrite prompt·⌥')
  })

  it('no squares under the orb during a session or at a checkpoint', async () => {
    const { local } = await mount('session')
    expect(screen.queryByTestId('side-next')).toBeNull()
    act(() => local.emit('overlay.changed', state('checkpoint')))
    expect(screen.queryByTestId('side-quiz')).toBeNull()
  })

  it('hides the pill while docked', async () => {
    const { local } = await mount('docked')
    act(() =>
      local.emit('overlay.changed', {
        ...state('docked'),
        pill: { label: 'Study', count: 2 },
        side: { next: { label: '1/3' }, quiz: false },
      }),
    )
    expect(screen.queryByTestId('study-pill')).toBeNull()
  })
})

describe('hit areas', () => {
  it('reports hover only when entering and leaving the hit areas', async () => {
    const { local } = await mount('pill')
    fireEvent.pointerMove(document.body)
    fireEvent.pointerMove(face())
    fireEvent.pointerMove(screen.getByTestId('study-pill'))
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
    const { local } = await mount('pill')
    fireEvent.pointerMove(screen.getByTestId('study-pill'), { clientX: 5, clientY: 5 })
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

describe('orb tooltip', () => {
  it('shows "Dumbledore · right ⌥" and the gestures after a short hover', async () => {
    await mount('idle')
    vi.useFakeTimers()
    fireEvent.pointerEnter(screen.getByTestId('orb'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Dumbledore· right ⌥ · tap: prompt · hold: tell it what you want, it writes the prompt · double-tap: chat',
    )
    fireEvent.pointerLeave(screen.getByTestId('orb'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
