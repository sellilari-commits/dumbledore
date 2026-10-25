/** Chat flows helpers: which open roadmap already covers a goal (never plan a second one). */
import { describe, expect, it } from 'vitest'
import { coveringRoadmap } from './flows'
import { chatWorld } from './testing'

describe('coveringRoadmap', () => {
  it('finds the open roadmap a goal is about, by whole words of its title, goal or subject', () => {
    const { repos } = chatWorld()
    expect(coveringRoadmap(repos, 'i want to deeply understand causal inference')?.id).toBe(
      'rdm_causal',
    )
    expect(coveringRoadmap(repos, 'neural networks')?.id).toBe('rdm_nn')
    expect(coveringRoadmap(repos, 'organic chemistry')).toBeNull()
    expect(coveringRoadmap(repos, 'learn')).toBeNull()
  })

  it('REGRESSION: "graph neural networks" is not covered by the Neural Networks roadmap', () => {
    const { repos } = chatWorld()
    expect(coveringRoadmap(repos, 'create me a course on graph neural networks')).toBeNull()
    expect(coveringRoadmap(repos, 'Graph Neural Networks')).toBeNull()
  })
})
