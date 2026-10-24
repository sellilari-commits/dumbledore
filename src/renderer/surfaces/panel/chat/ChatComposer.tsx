/**
 * The chat input pinned to the bottom of the panel: Enter sends (chat.send on thread 'panel'),
 * Esc clears typed text before it closes the panel, a failed send puts the text back.
 */
import { Spinner } from '@renderer/design-system'
import type { ChatView } from '@renderer/lib/chat'
import { CornerDownLeft } from 'lucide-react'
import { useState } from 'react'
import { report } from '../panel-actions'
import './chat.css'

export function ChatComposer({ chat }: { chat: ChatView }) {
  const [text, setText] = useState('')
  const canSend = text.trim().length > 0 && !chat.sending

  const submit = () => {
    const message = text.trim()
    if (!message || chat.sending) return
    setText('')
    chat.send(message).catch((error: unknown) => {
      report(error)
      setText(message)
    })
  }

  return (
    <form
      className="pn-composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="pn-composer__box">
        <input
          className="pn-composer__input"
          value={text}
          placeholder="Ask Dumbledore…"
          aria-label="Ask Dumbledore"
          // biome-ignore lint/a11y/noAutofocus: the panel opens ready for a question, Spotlight-style
          autoFocus
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text) {
              e.preventDefault()
              setText('')
            }
          }}
        />
        <button type="submit" className="pn-composer__send" aria-label="Send" disabled={!canSend}>
          {chat.sending ? <Spinner size={12} /> : <CornerDownLeft size={14} strokeWidth={2} />}
        </button>
      </div>
    </form>
  )
}
