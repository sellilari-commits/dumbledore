import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { HighlightWatcher, MAX_HIGHLIGHT_CHARS, normalizeHighlight } from './highlights'
import { runFor, ScriptedHelper } from './testing/scripted-helper'

describe('normalizeHighlight', () => {
  it('collapses whitespace, drops tiny selections and cuts long ones', () => {
    expect(normalizeHighlight('  James  Finlayson\nfounded a mill ')).toBe(
      'James Finlayson founded a mill',
    )
    expect(normalizeHighlight('ab')).toBeNull()
    expect(normalizeHighlight(null)).toBeNull()
    expect(normalizeHighlight('word '.repeat(1000))?.length).toBe(MAX_HIGHLIGHT_CHARS - 1)
  })

  it('trims word pieces cut at the edges and drops fragments under three words', () => {
    expect(normalizeHighlight("n John von Neumann's model. The")).toBe("John von Neumann's model.")
    expect(normalizeHighlight('James Finlayson founded a')).toBe('James Finlayson founded')
    expect(normalizeHighlight('rs (hidden layers). A n')).toBeNull()
    expect(normalizeHighlight('graphics processing')).toBeNull()
    expect(normalizeHighlight('ally called a')).toBeNull()
    expect(normalizeHighlight('Backpropagation computes the gradient')).toBe(
      'Backpropagation computes the gradient',
    )
  })
})

describe('HighlightWatcher', () => {
  let clock: FakeClock
  let helper: ScriptedHelper
  let caught: { text: string; at: number }[]
  let allowed: boolean
  let watcher: HighlightWatcher

  beforeEach(() => {
    clock = new FakeClock('2026-10-24T09:00:00.000Z')
    helper = new ScriptedHelper(clock)
    caught = []
    allowed = true
    watcher = new HighlightWatcher({
      helper,
      clock,
      canWatch: () => allowed,
      onHighlight: (text) => caught.push({ text, at: clock.now() }),
    })
    watcher.start()
  })

  it('catches a selection within a second of letting go, once', async () => {
    const start = clock.now()
    helper.selection = 'James Finlayson founded a cotton mill in 1820'
    await runFor(clock, 1000)
    expect(caught.map((c) => c.text)).toEqual(['James Finlayson founded a cotton mill in 1820'])
    expect((caught[0]?.at ?? Number.POSITIVE_INFINITY) - start).toBeLessThanOrEqual(1000)
    await runFor(clock, 5000)
    expect(caught).toHaveLength(1)
  })

  it('saves nothing while the selection keeps changing (still dragging)', async () => {
    const words = 'Scottish engineer James Finlayson founded a cotton mill'.split(' ')
    for (let i = 1; i <= words.length; i++) {
      helper.selection = words.slice(0, i).join(' ')
      await runFor(clock, 500)
    }
    expect(caught.filter((c) => c.text !== words.join(' '))).toEqual([])
    await runFor(clock, 1000)
    expect(caught.map((c) => c.text)).toEqual([words.join(' ')])
  })

  it('catches the same text again after it was deselected', async () => {
    helper.selection = 'Tammerkoski rapids in Tampere'
    await runFor(clock, 1000)
    helper.selection = null
    await runFor(clock, 1000)
    helper.selection = 'Tammerkoski rapids in Tampere'
    await runFor(clock, 1000)
    expect(caught).toHaveLength(2)
  })

  it('does not poll while watching is not allowed, and ignores helper errors', async () => {
    allowed = false
    helper.selection = 'Tampella (formed in 1861)'
    await runFor(clock, 3000)
    expect(helper.callsOf('ax.selectedText')).toHaveLength(0)
    expect(caught).toEqual([])
    allowed = true
    helper.failNext.add('ax.selectedText')
    await runFor(clock, 2000)
    expect(caught.map((c) => c.text)).toEqual(['Tampella (formed in 1861)'])
  })

  it('stops polling when stopped', async () => {
    watcher.stop()
    helper.selection = 'King Gustav III'
    await runFor(clock, 3000)
    expect(helper.callsOf('ax.selectedText')).toHaveLength(0)
  })
})
