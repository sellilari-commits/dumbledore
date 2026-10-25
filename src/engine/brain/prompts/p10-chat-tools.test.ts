import { describe, expect, it } from 'vitest'
import { TOOL_RESULTS_HEADER } from '../llm/tool-loop'
import { CHAT_ACTS, chatToolsSystem, isClearQuestion } from './p10-chat-tools'

const system = chatToolsSystem({
  profile: 'First-year chemistry student',
  context: 'Subjects: Organic Chemistry (id sub_1)',
  history: [],
  message: 'hi',
})

describe('P10 chat with tools', () => {
  it('keeps the coach persona and includes the profile and context', () => {
    expect(system).toMatch(/calm, warm, wise learning coach/)
    expect(system).toMatch(/end with a concrete next step/)
    expect(system).toMatch(/Answer in the student's language/)
    expect(system).toMatch(/Never do the student's assignments/)
    expect(system).toMatch(/<profile>\nFirst-year chemistry student\n<\/profile>/)
    expect(system).toMatch(/<context>\nSubjects: Organic Chemistry \(id sub_1\)\n<\/context>/)
  })

  it('reads before writing and never guesses ids', () => {
    expect(system).toMatch(/Read before you write\. Never invent or guess an id/)
    expect(system).toMatch(/only ids written in the context or returned by an earlier tool result/)
    expect(system).toMatch(/Check what exists before you create anything/)
  })

  it('continues an existing roadmap instead of starting a new one', () => {
    expect(system).toMatch(/roadmap exists[^\n]*never offer or start a new one/)
    expect(system).toMatch(/"What are the steps\?" → read that roadmap and list its steps/)
  })

  it('writes without asking, never claims an unmade change, confirms a delete by a typed yes', () => {
    expect(system).toMatch(/receipt with Undo[^\n]*don't ask permission for ordinary edits/)
    expect(system).toMatch(/Never claim a change you did not make through a tool/)
    expect(system).toMatch(/Delete asks first[^\n]*word for word[^\n]*says yes[^\n]*confirmed true/)
    expect(system).toMatch(/as few tool calls as needed/)
  })

  it('has no buttons or chips: acts when clear, asks one plain question when not', () => {
    expect(system).toMatch(/no buttons, chips or links to press/)
    expect(system).toMatch(/Never tell the student to press or click anything/)
    expect(system).toMatch(/When the request is clear, act at once/)
    expect(system).toMatch(/ask one clear question and do nothing else this turn/)
    expect(system).not.toMatch(/press the button|press it\b|Open Claude and paste/i)
  })

  it('names the acts, defers app actions to the act tool, and saves questions', () => {
    for (const name of CHAT_ACTS) expect(system).toContain(name)
    expect(system).toMatch(/app actions listed in the act tool's description/)
    expect(system).toMatch(/stuck[^\n]*act save_question/)
  })

  it('opens their usual AI with a prompt when no AI chat is open', () => {
    expect(system).toMatch(/or opens their usual AI with it when none is open \(never sends it\)/)
    expect(system).not.toMatch(/never open a website/i)
  })

  it('runs the old long-press flows and roadmap history from the chat', () => {
    expect(system).toMatch(/act write_prompt with their wish in their words/)
    expect(system).toMatch(/study_now \(they want to start now/)
    expect(system).toMatch(/act open_topic/)
    expect(system).toMatch(/read roadmap_history[^\n]*restore_roadmap_version/)
    expect(system).toMatch(/Never delete a roadmap to replace it/)
  })

  it('uses web_search only outside their data and cites sources', () => {
    expect(system).toMatch(/web_search only for facts outside the student's own data/)
    expect(system).toMatch(/Cite what you used by its source title/)
  })

  it('explains the tool-results turn', () => {
    expect(system).toContain(`A user turn starting with ${TOOL_RESULTS_HEADER} comes from the app`)
  })
})

/** Ilari: "the questions should be really clear." */
describe('P10 clarifying questions', () => {
  it('gives the rules with a good and a bad example', () => {
    expect(system).toMatch(
      /ONE question per reply, one short sentence, with nothing else around it/,
    )
    expect(system).toMatch(/Name the real things by name[^\n]*2 \(at most 3\) concrete options/)
    expect(system).toMatch(/Say what will happen\. Plain words: course, topic, step, note/)
    expect(system).toContain(
      'Good: "Add Graph Neural Networks to your Neural Networks course, or make it a new course?"',
    )
    expect(system).toContain('Bad: "Should I add this to an existing subject?"')
    expect(system).toMatch(/Asking \(only when it really matters; otherwise act/)
  })

  it('isClearQuestion accepts clear questions', () => {
    for (const good of [
      'Add Graph Neural Networks to your Neural Networks course, or make it a new course?',
      'Delete the note “Colliders block paths” from Causal Inference? Say yes to delete it.',
      'Move SN1 reactions to Organic Chemistry or keep it in Chemistry?',
      'Set your Statistics exam to 12 December or 19 December?',
    ])
      expect(isClearQuestion(good), good).toBe(true)
  })

  it('isClearQuestion rejects vague, padded, two-part or internal questions', () => {
    for (const bad of [
      'Should I add this to an existing subject?',
      'Sure! I can help with that. Add it to Neural Networks or make a new course?',
      'Add it to Neural Networks or a new course? And what level are you?',
      'Use concept nn_12 or make a new course?',
      'Add it to subject sub_01 or create a new one?',
      'What would you like me to do?',
      'Add Graph Neural Networks to your Neural Networks course, or make it a new course.',
    ])
      expect(isClearQuestion(bad), bad).toBe(false)
  })
})
