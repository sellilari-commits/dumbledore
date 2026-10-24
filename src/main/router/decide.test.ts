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

  it('(a) pastes the next step when a session runs in an AI chat — outside the box, before reading anything', () => {
    const page = { pid: 501, editable: false, secure: false, valueLength: null }
    expect(decide('tap', ctx({ sessionActive: true, aiChat: CHAT, focused: page }))).toEqual({
      kind: 'sessionNext',
    })
    expect(decide('tap', ctx({ sessionActive: true, aiChat: CHAT }))).toEqual({
      kind: 'sessionNext',
    })
  })

  it('(a) in the AI-chat box, a session reads the field first; empty → the next step', () => {
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

  it('(b) runs a `/d …` line as an instruction, in any field', () => {
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

  it('(c) studies the last subject from an empty AI-chat box; typed text is rewritten in place', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(), fieldText: '' }))).toEqual({
      kind: 'studyLast',
    })
    expect(
      decide('tap', ctx({ aiChat: CHAT, focused: chatBox(15), fieldText: ' what is osmosis ' })),
    ).toEqual({ kind: 'improve', draft: 'what is osmosis' })
  })

  it('(c) a tap rewrites typed text during a session too', () => {
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
    ).toEqual({ kind: 'studyLast' })
  })

  it('a chip click is a tap that rewrites typed text', () => {
    expect(
      decide('chip', ctx({ aiChat: CHAT, focused: chatBox(15), fieldText: ' what is osmosis ' })),
    ).toEqual({ kind: 'improve', draft: 'what is osmosis' })
    expect(decide('chip', ctx({ aiChat: CHAT, focused: chatBox(), fieldText: '' }))).toEqual({
      kind: 'suggest',
    })
  })

  it('(c) reports an unreadable chat box that has text', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(12), fieldText: null }))).toEqual({
      kind: 'unreadable',
    })
  })

  it('(d) offers actions for a selection (after the field checks)', () => {
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

  it('(e) studies the last subject when an AI chat is open without a session', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, selection: '' }))).toEqual({ kind: 'studyLast' })
  })

  it('(f) toggles the mini panel anywhere else', () => {
    expect(decide('tap', ctx({ selection: null }))).toEqual({ kind: 'togglePanel' })
    expect(decide('tap', ctx({ focused: notesField, fieldText: 'hello', selection: '' }))).toEqual({
      kind: 'togglePanel',
    })
  })
})

describe('decide — hold opens the chat with choices, double-tap opens it plain', () => {
  const typed = { aiChat: CHAT, focused: chatBox(15), fieldText: 'what is osmosis' }

  it('hold opens the chat window with subject choices, without reading anything', () => {
    expect(decide('holdStart', ctx())).toEqual({ kind: 'chooseSubject' })
    expect(decide('holdStart', ctx({ aiChat: CHAT, focused: chatBox(15) }))).toEqual({
      kind: 'chooseSubject',
    })
    expect(decide('holdStart', ctx({ focused: notesField }))).toEqual({ kind: 'chooseSubject' })
  })

  it('hold never rewrites, runs instructions or pastes the next step', () => {
    expect(decide('holdStart', ctx({ ...typed, sessionActive: true }))).toEqual({
      kind: 'chooseSubject',
    })
    expect(
      decide('holdStart', ctx({ aiChat: CHAT, focused: chatBox(9), fieldText: '/d simpler' })),
    ).toEqual({ kind: 'chooseSubject' })
    expect(decide('holdStart', ctx({ ...typed, secureInput: true }))).toEqual({
      kind: 'chooseSubject',
    })
  })

  it('hold focuses the chat window when it is already open; a quiz card swallows it', () => {
    expect(decide('holdStart', ctx({ ...typed, askbarOpen: true }))).toEqual({
      kind: 'focusAskbar',
    })
    expect(decide('holdStart', ctx({ ...typed, quizOpen: true }))).toEqual({ kind: 'ignore' })
  })

  it('double-tap opens the chat window anywhere, or focuses it; hold end does nothing', () => {
    expect(decide('doubleTap', ctx())).toEqual({ kind: 'askbar' })
    expect(decide('doubleTap', ctx({ ...typed, sessionActive: true }))).toEqual({
      kind: 'askbar',
    })
    expect(decide('doubleTap', ctx({ askbarOpen: true }))).toEqual({ kind: 'focusAskbar' })
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
