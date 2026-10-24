/**
 * "Chat with Dumbledore": the panel thread (chat.history 'panel') with the latest messages, the
 * reply streaming in (chat.delta), starter questions when empty, and scrolling that follows a
 * conversation in progress.
 */
import type { ChatView } from '@renderer/lib/chat'
import { useEffect, useRef, useState } from 'react'
import { report } from '../panel-actions'
import { Section, SectionError, SectionLoading } from '../Section'
import { ChatMessageView, StreamingMessage } from './ChatMessage'
import './chat.css'

const RECENT = 6

export const STARTERS = ['What should I focus on today?', 'Quiz me']

export function ChatThread({ chat }: { chat: ChatView }) {
  const [showAll, setShowAll] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const live = chat.sending || chat.streaming !== null
  // Changes whenever a message is added or a streamed token arrives while one is on its way.
  const follow = live ? `${chat.messages.length}:${chat.streaming?.text.length ?? 0}` : null

  // Follow the conversation while a message is on its way, not when the panel first opens.
  useEffect(() => {
    if (!follow) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    end.current?.scrollIntoView({ block: 'end', behavior: calm ? 'auto' : 'smooth' })
  }, [follow])

  const hidden = showAll ? 0 : Math.max(0, chat.messages.length - RECENT)
  const visible = hidden > 0 ? chat.messages.slice(hidden) : chat.messages
  const empty = !chat.isLoading && !chat.error && chat.messages.length === 0 && !live

  return (
    <Section title="Chat with Dumbledore" className="pn-chat-section">
      {chat.isLoading ? <SectionLoading label="Loading the chat" /> : null}
      {chat.error ? <SectionError error={chat.error} /> : null}
      {hidden > 0 ? (
        <button type="button" className="pn-link pn-chat__earlier" onClick={() => setShowAll(true)}>
          Show {hidden} earlier {hidden === 1 ? 'message' : 'messages'}
        </button>
      ) : null}
      <div className="pn-chat" role="log" aria-label="Chat with Dumbledore">
        {visible.map((m) => (
          <ChatMessageView key={m.id} message={m} />
        ))}
        {chat.streaming ? <StreamingMessage text={chat.streaming.text} /> : null}
      </div>
      {empty ? (
        <div className="pn-starters">
          <p className="pn-note">Ask what to focus on, or say what you don’t get.</p>
          {STARTERS.map((q) => (
            <button
              key={q}
              type="button"
              className="pn-starter"
              onClick={() => void chat.send(q).catch(report)}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={end} className="pn-chat__end" />
    </Section>
  )
}
