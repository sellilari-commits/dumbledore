import { describe, expect, it } from 'vitest'
import { decide, instructionLine, type RouteContext } from './decide'

const CHAT = { pid: 501 }

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return {
    askbarOpen: false,
    quizOpen: false,
    sessionActive: false,
    aiChat: null,
    focused: null,
    secureInput: false,
    ...over,
  }
}

const chatBox = (valueLength = 0) => ({ pid: 501, editable: true, secure: false, valueLength })
const notesField = { pid: 777, editable: true, secure: false, valueLength: 10 }

describe('decide — the F4 tap table', () => {
  it('acts as Enter while the ask bar or the quiz card is open', () => {
    expect(decide('tap', ctx({ askbarOpen: true, sessionActive: true, aiChat: CHAT }))).toEqual({
      kind: 'enter',
      surface: 'askbar',
    })
    expect(decide('tap', ctx({ quizOpen: true }))).toEqual({ kind: 'enter', surface: 'overlay' })
  })

  it('refuses password fields and secure input', () => {
    expect(decide('tap', ctx({ secureInput: true }))).toEqual({ kind: 'refuseSecure' })
    expect(decide('tap', ctx({ focused: { ...chatBox(), secure: true }, aiChat: CHAT }))).toEqual({
      kind: 'refuseSecure',
    })
  })

  it('pastes the next step when a session runs in an AI chat — outside the box, before reading anything', () => {
    const page = { pid: 501, editable: false, secure: false, valueLength: null }
    expect(decide('tap', ctx({ sessionActive: true, aiChat: CHAT, focused: page }))).toEqual({
      kind: 'sessionNext',
    })
    expect(decide('tap', ctx({ sessionActive: true, aiChat: CHAT }))).toEqual({
      kind: 'sessionNext',
    })
  })

  it('in the AI-chat box, a session reads the field first; empty → the next step', () => {
    const session = { sessionActive: true, aiChat: CHAT, focused: chatBox() }
    expect(decide('tap', ctx(session))).toEqual({ kind: 'need', what: 'fieldText' })
    expect(decide('tap', ctx({ ...session, fieldText: '  ' }))).toEqual({ kind: 'sessionNext' })
  })

  it('does not treat a session without an AI chat as (a)', () => {
    expect(decide('tap', ctx({ sessionActive: true }))).toEqual({ kind: 'need', what: 'selection' })
  })

  it('asks for the field text only when a field is focused', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox() }))).toEqual({
      kind: 'need',
      what: 'fieldText',
    })
  })

  it('runs a `/d …` line as an instruction, in any field', () => {
    expect(
      decide('tap', ctx({ focused: notesField, fieldText: 'notes\n/d quiz me on chapter 3' })),
    ).toEqual({
      kind: 'instruction',
      text: 'quiz me on chapter 3',
      wholeField: false,
    })
    expect(
      decide('tap', ctx({ aiChat: CHAT, focused: chatBox(13), fieldText: '/d make it simpler' })),
    ).toEqual({
      kind: 'instruction',
      text: 'make it simpler',
      wholeField: true,
    })
  })

  it('pastes the best next prompt into an empty AI-chat box; typed text is rewritten in place', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(), fieldText: '' }))).toEqual({
      kind: 'suggest',
    })
    expect(
      decide('tap', ctx({ aiChat: CHAT, focused: chatBox(15), fieldText: ' what is osmosis ' })),
    ).toEqual({ kind: 'improve', draft: 'what is osmosis' })
  })

  it('a tap rewrites typed text during a session too', () => {
    expect(
      decide(
        'tap',
        ctx({
          sessionActive: true,
          aiChat: CHAT,
          focused: chatBox(15),
          fieldText: 'what is osmosis',
        }),
      ),
    ).toEqual({ kind: 'improve', draft: 'what is osmosis' })
  })

  it('a tap never rewrites a field outside the AI-chat box', () => {
    expect(
      decide('tap', ctx({ aiChat: CHAT, focused: notesField, fieldText: 'x', selection: '' })),
    ).toEqual({ kind: 'suggest' })
  })

  it('a chip click is a tap that rewrites typed text', () => {
    expect(
      decide('chip', ctx({ aiChat: CHAT, focused: chatBox(15), fieldText: ' what is osmosis ' })),
    ).toEqual({ kind: 'improve', draft: 'what is osmosis' })
    expect(decide('chip', ctx({ aiChat: CHAT, focused: chatBox(), fieldText: '' }))).toEqual({
      kind: 'suggest',
    })
  })

  it('reports an unreadable chat box that has text', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(12), fieldText: null }))).toEqual({
      kind: 'unreadable',
    })
  })

  it('offers actions for a selection (after the field checks)', () => {
    expect(decide('tap', ctx({ focused: notesField, fieldText: 'plain text' }))).toEqual({
      kind: 'need',
      what: 'selection',
    })
    expect(
      decide(
        'tap',
        ctx({ focused: notesField, fieldText: 'plain text', selection: ' SN1 is unimolecular ' }),
      ),
    ).toEqual({ kind: 'selection', text: 'SN1 is unimolecular' })
  })

  it('pastes the best next prompt when an AI chat is open without a session (never a roadmap)', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, selection: '' }))).toEqual({ kind: 'suggest' })
  })

  it('a tap never outlines or clears marks: that is the hold', () => {
    expect(decide('tap', ctx({ outlineShown: true, selection: '' }))).toEqual({
      kind: 'togglePanel',
    })
    expect(
      decide('tap', ctx({ outlineShown: true, sessionActive: true, aiChat: CHAT, selection: '' })),
    ).toEqual({ kind: 'sessionNext' })
  })

  it('a tap closes the open panel instead of prompting', () => {
    expect(decide('tap', ctx({ panelOpen: true, aiChat: CHAT, selection: '' }))).toEqual({
      kind: 'togglePanel',
    })
  })

  it('toggles the mini panel anywhere else', () => {
    expect(decide('tap', ctx({ selection: null }))).toEqual({ kind: 'togglePanel' })
    expect(decide('tap', ctx({ focused: notesField, fieldText: 'hello', selection: '' }))).toEqual({
      kind: 'togglePanel',
    })
  })
})

describe('decide — hold outlines what is on screen, double-tap opens the chat', () => {
  const typed = { aiChat: CHAT, focused: chatBox(15), fieldText: 'what is osmosis' }

  it('hold outlines anywhere, the AI chat included, without reading the field', () => {
    expect(decide('holdStart', ctx())).toEqual({ kind: 'outline' })
    expect(decide('holdStart', ctx({ aiChat: CHAT, focused: chatBox(15) }))).toEqual({
      kind: 'outline',
    })
    expect(decide('holdStart', ctx({ focused: notesField }))).toEqual({ kind: 'outline' })
  })

  it('hold never rewrites, runs instructions or pastes the next step; again, it clears', () => {
    expect(decide('holdStart', ctx({ ...typed, sessionActive: true }))).toEqual({
      kind: 'outline',
    })
    expect(
      decide('holdStart', ctx({ aiChat: CHAT, focused: chatBox(9), fieldText: '/d simpler' })),
    ).toEqual({ kind: 'outline' })
    expect(decide('holdStart', ctx({ outlineShown: true, aiChat: CHAT }))).toEqual({
      kind: 'clearOutline',
    })
  })

  it('hold focuses the ask bar when it is already open; a quiz card swallows it', () => {
    expect(decide('holdStart', ctx({ ...typed, askbarOpen: true }))).toEqual({
      kind: 'focusAskbar',
    })
    expect(decide('holdStart', ctx({ ...typed, quizOpen: true }))).toEqual({ kind: 'ignore' })
  })

  it('double-tap toggles the chat window; from the study box it switches to the chat', () => {
    expect(decide('doubleTap', ctx())).toEqual({ kind: 'askbar' })
    expect(decide('doubleTap', ctx({ ...typed, sessionActive: true }))).toEqual({
      kind: 'askbar',
    })
    expect(decide('doubleTap', ctx({ askbarOpen: true, askbarRoute: 'chat' }))).toEqual({
      kind: 'closeAskbar',
    })
    expect(decide('doubleTap', ctx({ askbarOpen: true }))).toEqual({ kind: 'closeAskbar' })
    expect(decide('doubleTap', ctx({ askbarOpen: true, askbarRoute: 'prompt' }))).toEqual({
      kind: 'focusAskbar',
    })
    expect(decide('holdEnd', ctx(typed))).toEqual({ kind: 'ignore' })
  })
})

describe('instructionLine', () => {
  it('finds the last /d line', () => {
    expect(instructionLine('/d one\n/d two')).toEqual({ text: 'two', wholeField: false })
    expect(instructionLine('  /d   spaced out  ')).toEqual({ text: 'spaced out', wholeField: true })
  })

  it('ignores lookalikes', () => {
    expect(instructionLine('/dx nope')).toBeNull()
    expect(instructionLine('see /d inside')).toBeNull()
    expect(instructionLine('/d ')).toBeNull()
    expect(instructionLine(null)).toBeNull()
  })
})
