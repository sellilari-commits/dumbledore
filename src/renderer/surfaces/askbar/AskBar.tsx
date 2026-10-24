/**
 * The Ask bar: a Spotlight-like 560 × 52 input with the spectacles glyph that grows into a chat
 * with Dumbledore (thread 'ask'). The conversation sits above the input; the window grows with it
 * up to 600 pt, then the conversation scrolls. Enter sends, Shift+Enter adds a line, Esc closes
 * and hands focus back, ⌘N (or the pen icon) starts a new chat. Opened with route 'choose', recent
 * subjects are offered above the input first (see useChoose).
 */
import type { DumbledoreApi } from '@shared/ipc'
import { SquarePen } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { SpectaclesGlyph } from '../overlay/glyph/SpectaclesGlyph'
import { AskLog } from './AskLog'
import { SubjectChoices } from './SubjectChoices'
import { useAsk } from './useAsk'
import { useChoose } from './useChoose'
import { useWindowAutoSize } from './useWindowAutoSize'
import './askbar.css'

export const PLACEHOLDER = 'Ask Dumbledore — e.g. ‘I don’t get recursion’'
export const FOLLOW_UP = 'Reply to Dumbledore…'
export const NEW_TOPIC = 'What do you want to learn? e.g. ‘the Calvin cycle’'
export const OR_ASK = 'Or ask Dumbledore anything…'

export function AskBar({ api }: { api: DumbledoreApi }) {
  const chat = useAsk(api)
  const choose = useChoose(api, chat.close)
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const maxHeight = useWindowAutoSize(api, card)
  const busy = chat.pending !== null
  const open = chat.messages.length > 0 || busy || chat.error !== null
  const choosing = choose.active && !choose.newTopic

  const send = () => {
    const question = text.trim()
    if (!question) return
    if (choose.active && choose.newTopic) {
      setText('')
      choose.startTopic(question)
      return
    }
    if (busy) return
    setText('')
    choose.exit()
    void chat.submit(question).then((sent) => {
      if (!sent) setText((now) => (now.trim() ? now : question))
    })
  }

  const newTopic = () => {
    choose.startNewTopic()
    input.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const rows = choose.choices.length + 1
    if (choosing && !text && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : rows - 1
      choose.setHighlight((choose.highlight + step) % rows)
      return
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    if (choosing && !text.trim()) {
      const subject = choose.choices[choose.highlight]
      if (subject) choose.pick(subject.id)
      else newTopic()
      return
    }
    send()
  }

  // Esc closes and ⌘N starts over from anywhere; coming back to the window reloads the chat.
  const { close, refresh, newChat } = chat
  const { exit } = choose
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        exit()
        close()
      } else if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newChat()
        input.current?.focus()
      }
    }
    // No select(): the input is cleared on send, and a late focus event mustn't eat typing.
    const onFocus = () => {
      input.current?.focus()
      refresh()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', onFocus)
    }
  }, [close, exit, newChat, refresh])

  const placeholder = choose.active
    ? choose.newTopic
      ? NEW_TOPIC
      : OR_ASK
    : open
      ? FOLLOW_UP
      : PLACEHOLDER
  return (
    <div
      className="ask"
      ref={card}
      data-mode={open ? 'chat' : 'bar'}
      data-choosing={choose.active || undefined}
      style={{ maxHeight }}
    >
      {open && <AskLog chat={chat} />}
      {choosing && (
        <SubjectChoices choose={choose} enterPicks={!text.trim()} onNewTopic={newTopic} />
      )}
      <div className="ask__composer">
        <SpectaclesGlyph className="ask__glyph" size={22} />
        <textarea
          ref={input}
          className="ask__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Ask Dumbledore"
          // biome-ignore lint/a11y/noAutofocus: the bar exists to be typed into the moment it opens
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            if (!e.target.value.trim() && chat.messages.length === 0 && !busy) chat.dismissError()
          }}
          onKeyDown={onKeyDown}
        />
        {busy && !choose.newTopic ? (
          <span className="ov-spinner ask__busy" role="status" aria-label="Thinking" />
        ) : (
          text.trim() && (
            <kbd className="ov-key ask__enter" aria-hidden>
              ↵
            </kbd>
          )
        )}
        {open && (
          <button
            type="button"
            className="ov-icon-btn ask__new"
            aria-label="New chat"
            title="New chat · ⌘N"
            aria-disabled={busy || undefined}
            onClick={() => {
              chat.newChat()
              input.current?.focus()
            }}
          >
            <SquarePen size={15} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
