/**
 * The Ask bar: a Spotlight-like 560 × 52 input with the spectacles glyph that grows into a chat
 * with Dumbledore (thread 'ask'). The conversation sits above the input; the window grows with it
 * up to 600 pt, then the conversation scrolls. Enter sends, Shift+Enter adds a line, Esc closes
 * and hands focus back, ⌘N (or the pen icon) starts a new chat. Opened with route 'prompt' (right
 * ⌥ hold), it is the prompt box instead: the student says what they want, Dumbledore writes the
 * prompt and pastes it into the AI chat (see usePromptBox).
 */
import type { DumbledoreApi } from '@shared/ipc'
import { SquarePen } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { SpectaclesGlyph } from '../overlay/glyph/SpectaclesGlyph'
import { AskLog } from './AskLog'
import { useAsk } from './useAsk'
import { promptHint, usePromptBox } from './usePromptBox'
import { useWindowAutoSize } from './useWindowAutoSize'
import './askbar.css'

export const PLACEHOLDER = 'Ask Dumbledore — e.g. ‘I don’t get recursion’'
export const FOLLOW_UP = 'Reply to Dumbledore…'
export const PROMPT_PLACEHOLDER = 'What should the prompt ask? Dumbledore writes it'

export function AskBar({ api }: { api: DumbledoreApi }) {
  const chat = useAsk(api)
  const promptBox = usePromptBox(api)
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const maxHeight = useWindowAutoSize(api, card)
  const prompting = promptBox.active
  const busy = prompting ? promptBox.busy : chat.pending !== null
  const open =
    !prompting && (chat.messages.length > 0 || chat.pending !== null || chat.error !== null)

  const send = () => {
    const question = text.trim()
    if (!question || busy) return
    if (prompting) {
      void promptBox.submit(question).then((written) => {
        if (written) setText('')
      })
      return
    }
    setText('')
    void chat.submit(question).then((sent) => {
      if (!sent) setText((now) => (now.trim() ? now : question))
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    send()
  }

  // Esc closes and ⌘N starts over from anywhere; coming back to the window reloads the chat.
  const { close, refresh, newChat } = chat
  const { exit } = promptBox
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

  const placeholder = prompting ? PROMPT_PLACEHOLDER : open ? FOLLOW_UP : PLACEHOLDER
  return (
    <div
      className="ask"
      ref={card}
      data-mode={open ? 'chat' : 'bar'}
      data-prompt={prompting || undefined}
      style={{ maxHeight }}
    >
      {open && <AskLog chat={chat} />}
      <div className="ask__composer">
        <SpectaclesGlyph className="ask__glyph" size={22} />
        <textarea
          ref={input}
          className="ask__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={prompting ? 'What should the prompt ask?' : 'Ask Dumbledore'}
          // biome-ignore lint/a11y/noAutofocus: the bar exists to be typed into the moment it opens
          autoFocus
          readOnly={prompting && busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            if (prompting) promptBox.dismissError()
            else if (!e.target.value.trim() && chat.messages.length === 0 && !busy)
              chat.dismissError()
          }}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <span
            className="ov-spinner ask__busy"
            role="status"
            aria-label={prompting ? 'Writing your prompt' : 'Thinking'}
          />
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
      {prompting &&
        (promptBox.error ? (
          <p className="ask__prompt-note ask__prompt-note--error" role="alert">
            {promptBox.error}
          </p>
        ) : (
          <p className="ask__prompt-note">
            {busy ? 'Writing your prompt…' : promptHint(promptBox.assistant)}
          </p>
        ))}
    </div>
  )
}
