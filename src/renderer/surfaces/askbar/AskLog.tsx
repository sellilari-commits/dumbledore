/**
 * The Ask bar conversation: the student's questions as grey bubbles on the right, Dumbledore's
 * markdown replies with their action chips on the left, the reply being written (streamed) and
 * the last error. It stays on the newest message unless the student scrolled up to read.
 */
import { Check } from 'lucide-react'
import { memo, useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionChips } from './ActionChips'
import type { AskController, AskError, AskMessage } from './useAsk'
import { useStickToBottom } from './useStickToBottom'

const MARKDOWN: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}
const PLUGINS = [remarkGfm]

function Reply({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="ask__reply" data-streaming={streaming || undefined}>
      <Markdown remarkPlugins={PLUGINS} components={MARKDOWN}>
        {text}
      </Markdown>
    </div>
  )
}

interface MessageProps {
  message: AskMessage
  onRun: AskController['runAction']
}

/** Memoised: while a reply streams in, only the streaming bubble re-renders. */
const Message = memo(function Message({ message, onRun }: MessageProps) {
  if (message.role === 'user') {
    return <div className="ask__msg ask__msg--user">{message.content}</div>
  }
  if (!message.content && !message.pasted && message.actions.length === 0) return null
  return (
    <div className="ask__msg ask__msg--assistant">
      {message.content && <Reply text={message.content} />}
      {message.pasted && (
        <p className="ask__pasted">
          <Check size={14} aria-hidden /> Pasted into the chat box
        </p>
      )}
      <ActionChips actions={message.actions} onRun={onRun} />
    </div>
  )
})

function errorText({ message, retry }: AskError): string {
  const sentence = /[.!?…]$/.test(message) ? message : `${message}.`
  return retry ? `${sentence} Press ↵ to try again.` : sentence
}

export function AskLog({ chat }: { chat: AskController }) {
  const scroller = useRef<HTMLDivElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const lastQuestion = chat.messages.findLast((m) => m.role === 'user')?.id ?? null
  useStickToBottom(scroller, thread, lastQuestion)
  const { pending, error } = chat
  return (
    <div className="ask__log" ref={scroller}>
      <div
        className="ask__thread"
        ref={thread}
        role="log"
        aria-label="Conversation with Dumbledore"
      >
        {chat.messages.map((m) => (
          <Message key={m.id} message={m} onRun={chat.runAction} />
        ))}
        {pending && (
          <div className="ask__msg ask__msg--assistant" aria-live="polite">
            {pending.text ? (
              <Reply text={pending.text} streaming />
            ) : (
              <p className="ask__thinking">Thinking…</p>
            )}
          </div>
        )}
        {error && (
          <p className="ask__error" role="alert">
            {errorText(error)}
          </p>
        )}
      </div>
    </div>
  )
}
