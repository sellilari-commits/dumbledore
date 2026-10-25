import { describe, expect, it } from 'vitest'
import { TOOL_RESULTS_HEADER } from '../llm/tool-loop'
import { CHAT_ACTS, chatToolsSystem } from './p10-chat-tools'

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

  it('writes without asking, never claims an unmade change, deletes through a button', () => {
    expect(system).toMatch(/receipt with Undo[^\n]*don't ask permission for ordinary edits/)
    expect(system).toMatch(/Never claim a change you did not make through a tool/)
    expect(system).toMatch(/Delete never deletes straight away[^\n]*Tell them to press it/)
    expect(system).toMatch(/as few tool calls as needed/)
  })

  it('names the acts, defers app actions to the act tool, and saves questions', () => {
    for (const name of CHAT_ACTS) expect(system).toContain(name)
    expect(system).toMatch(/app actions listed in the act tool's description/)
    expect(system).toMatch(/stuck[^\n]*act save_question/)
  })

  it('never opens a website unless the student asked, and offers the button instead', () => {
    expect(system).toMatch(/never open a website, a browser tab or their AI yourself/)
    expect(system).toMatch(/Only when the student's own message asks you to open their AI/)
    expect(system).toMatch(/Dumbledore's own pages[^\n]*may open/)
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
