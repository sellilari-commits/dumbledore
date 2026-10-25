/**
 * Chat flows helpers: when the student's message asked to open their AI (the only case a turn
 * may open a website), and which open roadmap already covers a goal (never plan a second one).
 */
import { describe, expect, it } from 'vitest'
import { askedToOpen, coveringRoadmap } from './flows'
import { chatWorld } from './testing'

describe('askedToOpen', () => {
  it('is true only when the message asks to open an AI, a browser or a site', () => {
    for (const yes of [
      'open ChatGPT and paste it',
      'Open Claude and put the prompt there',
      'can you launch gemini with that',
      'avaa ChatGPT ja liitä se',
      'open it in my AI',
      'open a new browser tab with that',
    ]) {
      expect(askedToOpen(yes), yes).toBe(true)
    }
    for (const no of [
      'write me a prompt about colliders',
      'open the causal inference topic',
      'open my statistics subject',
      'what does ChatGPT know about DAGs?',
      'paste it into ChatGPT',
      'I want to learn organic chemistry',
    ]) {
      expect(askedToOpen(no), no).toBe(false)
    }
  })
})

describe('coveringRoadmap', () => {
  it('finds the open roadmap a goal is about, by its title, subject or topics', () => {
    const { repos } = chatWorld()
    expect(coveringRoadmap(repos, 'i want to deeply understand causal inference')?.id).toBe(
      'rdm_causal',
    )
    expect(coveringRoadmap(repos, 'neural networks')?.id).toBe('rdm_nn')
    expect(coveringRoadmap(repos, 'organic chemistry')).toBeNull()
    expect(coveringRoadmap(repos, 'learn')).toBeNull()
  })
})
