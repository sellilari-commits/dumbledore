/**
 * The Ask bar. Double-tap on right ⌥ opens the chat with Dumbledore (thread 'ask'): a tall, narrow
 * panel beside the orb with the conversation filling it (newest at the bottom) and the input at
 * the bottom. Enter sends, Shift+Enter adds a line, Esc closes and hands focus back, ⌘N (or the pen
 * icon) starts a new chat. Opened with route 'prompt' (no gesture opens it since hold became the
 * outline, 2026-10-25; to fold into the chat or remove), it is the compact study box
 * instead (560 × 52, growing with its note): the student says what they want to study, Dumbledore
 * builds the subject's roadmap and pastes its first prompt into the AI chat (see usePromptBox).
 * The chat itself never pastes anything.
 * In chat mode every topic sits on top of the input as a chip (TopicChips): a selected topic's
 * subject goes with every question as context, ↵ on an empty input studies it, ←/→ move the
 * selection while the input is empty. Like the orb and the mini panel, the window follows the
 * theme in Settings (light, dark or the system's).
 */
import type { DumbledoreApi } from '@shared/ipc'
import { SquarePen } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { SpectaclesGlyph } from '../overlay/glyph/SpectaclesGlyph'
import { useOverlaySettings } from '../overlay/lib/useOverlaySettings'
import { AskLog } from './AskLog'
import { TopicChips } from './TopicChips'
import { useAsk } from './useAsk'
import { promptHint, usePromptBox } from './usePromptBox'
import { useTopics } from './useTopics'
import { useWindowAutoSize } from './useWindowAutoSize'
import './askbar.css'

export const PLACEHOLDER = 'Type here…'
export const FOLLOW_UP = 'Reply to Dumbledore…'
export const PROMPT_PLACEHOLDER = 'Open a topic'
export const EMPTY_CHAT = 'Ask anything or give feedback on your study plan.'
export const CHAT_TITLE = 'Tell Dumbledore how to do its work'

/** The input's placeholder while a topic is selected. */
export const topicPlaceholder = (name: string, open: boolean) =>
  open ? `Reply about ${name}…` : `Ask about ${name}…`

export function AskBar({ api }: { api: DumbledoreApi }) {
  useOverlaySettings(api)
  const chat = useAsk(api)
  const promptBox = usePromptBox(api)
  const topics = useTopics(api, chat.close, !promptBox.active)
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const prompting = promptBox.active
  const maxHeight = useWindowAutoSize(api, card, !prompting)
  const busy = prompting ? promptBox.busy : chat.pending !== null || topics.starting
  const topic = prompting ? null : topics.selected
  const open =
    !prompting && (chat.messages.length > 0 || chat.pending !== null || chat.error !== null)

  const send = () => {
    const question = text.trim()
    if (busy) return
    if (!question) {
      // An empty ↵ studies the selected topic (and closes the bar); with none it does nothing.
      if (topic && !text) void topics.study()
      return
    }
    if (prompting) {
      void promptBox.submit(question).then((written) => {
        if (written) setText('')
      })
      return
    }
    setText('')
    void chat.submit(question, topic?.subjectId).then((sent) => {
      if (!sent) setText((now) => (now.trim() ? now : question))
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (
      !prompting &&
      !text &&
      topics.topics.length > 0 &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      e.preventDefault()
      topics.move(e.key === 'ArrowLeft' ? -1 : 1)
      return
    }
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

  const placeholder = prompting
    ? PROMPT_PLACEHOLDER
    : topic
      ? topicPlaceholder(topic.name, open)
      : open
        ? FOLLOW_UP
        : PLACEHOLDER
  const showTopics = !prompting && topics.topics.length > 0
  return (
    <div
      className="ask"
      ref={card}
      data-mode={open ? 'chat' : 'bar'}
      data-layout={prompting ? 'bar' : 'panel'}
      data-prompt={prompting || undefined}
      style={prompting ? { maxHeight } : undefined}
    >
      {!prompting && (
        <header className="ask__head">
          <SpectaclesGlyph className="ask__head-glyph" size={18} />
          <h1 className="ask__title">{CHAT_TITLE}</h1>
          <button
            type="button"
            className="ov-icon-btn ask__new"
            aria-label="New chat"
            title="New chat · ⌘N"
            aria-disabled={busy || !open || undefined}
            onClick={() => {
              chat.newChat()
              input.current?.focus()
            }}
          >
            <SquarePen size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
      )}
      {open ? (
        <AskLog chat={chat} />
      ) : (
        !prompting && (
          <p className="ask__empty" data-testid="ask-empty">
            {EMPTY_CHAT}
          </p>
        )
      )}
      {showTopics && (
        <TopicChips
          topics={topics.topics}
          selectedId={topic?.id ?? null}
          onToggle={(id) => {
            topics.toggle(id)
            input.current?.focus()
          }}
        />
      )}
      <div className="ask__composer">
        {prompting && <SpectaclesGlyph className="ask__glyph" size={22} />}
        <textarea
          ref={input}
          className="ask__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={prompting ? PROMPT_PLACEHOLDER : 'Ask Dumbledore'}
          aria-description={
            topic ? `Topic: ${topic.name}. Enter with no text studies it.` : undefined
          }
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
            aria-label={
              prompting ? 'Building your roadmap' : topics.starting ? 'Starting' : 'Thinking'
            }
          />
        ) : text.trim() ? (
          <kbd className="ov-key ask__enter" aria-hidden>
            ↵
          </kbd>
        ) : (
          topic &&
          !text && (
            <span className="ask__study">
              Study <kbd className="ov-key">↵</kbd>
            </span>
          )
        )}
      </div>
      {!prompting && topics.error && (
        <p className="ask__prompt-note ask__prompt-note--error" role="alert">
          {topics.error}
        </p>
      )}
      {prompting &&
        (promptBox.error ? (
          <p className="ask__prompt-note ask__prompt-note--error" role="alert">
            {promptBox.error}
          </p>
        ) : (
          <p className="ask__prompt-note">
            {busy ? 'Building your roadmap…' : promptHint(promptBox.assistant)}
          </p>
        ))}
    </div>
  )
}
