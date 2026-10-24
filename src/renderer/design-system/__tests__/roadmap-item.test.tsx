/** RoadmapItem: a sent step waits for the AI's answer before it is done. */
import type { LearnItem } from '@shared/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../../lib/test-utils'
import { RoadmapItem } from '../components/RoadmapItem'

const step = (patch: Partial<LearnItem>): LearnItem => ({
  kind: 'learn',
  id: 'itm_1',
  idx: 0,
  title: 'SN1 mechanism',
  objective: 'Explain the two steps',
  concepts: ['SN1'],
  move: 'intuition',
  promptDraft: 'Explain SN1',
  promptSent: null,
  status: 'current',
  ...patch,
})

describe('RoadmapItem learn step', () => {
  it('shows "Current step" before the prompt was sent', () => {
    render(<RoadmapItem item={step({})} />)
    expect(screen.getByText('Current step')).toBeTruthy()
    expect(screen.queryByText('Waiting for the answer')).toBeNull()
  })

  it('shows "Waiting for the answer" once sent, and no check', () => {
    render(<RoadmapItem item={step({ promptSent: 'Explain SN1' })} />)
    expect(screen.getByText('Waiting for the answer')).toBeTruthy()
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
  })

  it('is checked only when done', () => {
    render(<RoadmapItem item={step({ promptSent: 'Explain SN1', status: 'done' })} />)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Waiting for the answer')).toBeNull()
  })
})
