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
    expect(
      decide('tap', ctx({ focused: { ...chatBox(), secure: true }, aiChat: CHAT })),
    ).toEqual({ kind: 'refuseSecure' })
  })

  it('(a) pastes the next step when a session runs in an AI chat — before reading anything', () => {
    expect(decide('tap', ctx({ sessionActive: true, aiChat: CHAT, focused: chatBox(5) }))).toEqual({
      kind: 'sessionNext',
    })
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
    expect(decide('tap', ctx({ focused: notesField, fieldText: 'notes\n/d quiz me on chapter 3' }))).toEqual({
      kind: 'instruction',
      text: 'quiz me on chapter 3',
      wholeField: false,
    })
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(13), fieldText: '/d make it simpler' }))).toEqual({
      kind: 'instruction',
      text: 'make it simpler',
      wholeField: true,
    })
  })

  it('(c) suggests for an empty AI-chat box and improves typed text', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(), fieldText: '' }))).toEqual({
      kind: 'suggest',
    })
    expect(decide('tap', ctx({ aiChat: CHAT, focused: chatBox(15), fieldText: ' what is osmosis ' }))).toEqual({
      kind: 'improve',
      draft: 'what is osmosis',
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
      decide('tap', ctx({ focused: notesField, fieldText: 'plain text', selection: ' SN1 is unimolecular ' })),
    ).toEqual({ kind: 'selection', text: 'SN1 is unimolecular' })
  })

  it('(e) opens the picker when an AI chat is open without a session', () => {
    expect(decide('tap', ctx({ aiChat: CHAT, selection: '' }))).toEqual({ kind: 'picker' })
  })

  it('(f) toggles the mini panel anywhere else', () => {
    expect(decide('tap', ctx({ selection: null }))).toEqual({ kind: 'togglePanel' })
    expect(decide('tap', ctx({ focused: notesField, fieldText: 'hello', selection: '' }))).toEqual({
      kind: 'togglePanel',
    })
  })

  it('hold and double-tap open the ask bar; hold end does nothing', () => {
    expect(decide('holdStart', ctx())).toEqual({ kind: 'askbar' })
    expect(decide('doubleTap', ctx({ sessionActive: true, aiChat: CHAT }))).toEqual({ kind: 'askbar' })
    expect(decide('doubleTap', ctx({ askbarOpen: true }))).toEqual({ kind: 'ignore' })
    expect(decide('holdEnd', ctx())).toEqual({ kind: 'ignore' })
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
