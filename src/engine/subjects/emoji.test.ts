import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBJECT_EMOJI, pickSubjectEmoji } from './emoji'

describe('pickSubjectEmoji', () => {
  it.each([
    ['Organic Chemistry', '🧪'],
    ['Linear Algebra', '📐'],
    ['Mathematics 101', '📐'],
    ['World History', '🏛️'],
    ['Art History', '🏛️'],
    ['Cell Biology', '🧬'],
    ['Intro to Programming', '💻'],
    ['Artificial Intelligence', '💻'],
    ['Spanish language', '🗣️'],
    ['English Literature', '📚'],
    ['Geography', '🌍'],
    ['Quantum Physics', '⚛️'],
    ['Particle physics', '⚛️'],
    ['Statistics', '📊'],
    ['Kemia 2', '🧪'],
    ['Matematiikka', '📐'],
    ['Ruotsin kieli', '🗣️'],
    ['Microeconomics', '📈'],
    ['Underwater basket weaving', DEFAULT_SUBJECT_EMOJI],
    ['', DEFAULT_SUBJECT_EMOJI],
  ])('%s → %s', (name, emoji) => {
    expect(pickSubjectEmoji(name)).toBe(emoji)
  })
})
