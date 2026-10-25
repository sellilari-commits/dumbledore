/**
 * The Ask bar conversation: the student's questions as grey bubbles on the right, Dumbledore's
 * markdown replies on the left, the reply being written (streamed) and the last error. Until the
 * reply arrives, the working indicator (Working.tsx: pulsing dots and the current step) stands
 * where it will appear, and comes back under streamed words while a tool runs. It stays on the
 * newest message unless the student scrolled up to read.
 * No buttons or chips under a reply: only receipt rows of what the chat did, with Undo where
 * there is one (Receipts.tsx). When the chat needs a choice it asks in plain text. A line of the reply
 * that only repeats one of them is left out of the text. Links in a reply (e.g. a web search's
 * "Sources: [title](url) · …") open only when clicked, in the default browser: they are
 * target=_blank anchors, which main's window open handler sends to shell.openExternal
 * (src/main/security.ts; navigating the window away is refused there too). Only http(s) and
 * mailto links are links; anything else stays plain text.
 */
import type { CoachAction } from '@shared/domain'
import { Check } from 'lucide-react'
import { memo, useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isReceipt, Receipts } from './Receipts'
import type { AskController, AskError, AskMessage } from './useAsk'
import { useStickToBottom } from './useStickToBottom'
import { Working } from './Working'

const OPENABLE = /^(https?:|mailto:)/i

/** Whether `href` is a link the default browser may open (react-markdown already drops javascript:). */
export const isOpenable = (href: string | undefined): href is string =>
  !!href && OPENABLE.test(href)

const MARKDOWN: Components = {
  a: ({ node: _node, href, children, ...props }) =>
    isOpenable(href) ? (
      <a {...props} href={href} title={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // A web search's sources line reads quieter than the answer.
  p: ({ node, ...props }) => {
    const first = node?.children[0]
    const sources = first?.type === 'text' && /^\s*Sources:/.test(first.value)
    return <p {...props} className={sources ? 'ask__sources' : undefined} />
  },
}
const PLUGINS = [remarkGfm]

/** The reply without lines that only repeat a receipt row shown under it. */
export function withoutReceiptLines(content: string, actions: CoachAction[]): string {
  const labels = new Set(actions.filter(isReceipt).map((a) => a.label.trim()))
  if (labels.size === 0) return content
  return content
    .split('\n')
    .filter((line) => !labels.has(line.trim().replace(/^[-*•]\s+/, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
  onRunInPlace: AskController['runInPlace']
}

/** Memoised: while a reply streams in, only the streaming bubble re-renders. */
const Message = memo(function Message({ message, onRunInPlace }: MessageProps) {
  if (message.role === 'user') {
    return <div className="ask__msg ask__msg--user">{message.content}</div>
  }
  if (!message.content && !message.pasted && message.actions.length === 0) return null
  const text = withoutReceiptLines(message.content, message.actions)
  return (
    <div className="ask__msg ask__msg--assistant">
      {text && <Reply text={text} />}
      <Receipts actions={message.actions} onRun={onRunInPlace} />
      {message.pasted && (
        <p className="ask__pasted">
          <Check size={14} aria-hidden /> Pasted into the chat box
        </p>
      )}
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
          <Message key={m.id} message={m} onRunInPlace={chat.runInPlace} />
        ))}
        {pending && (
          <div className="ask__msg ask__msg--assistant" aria-live="polite">
            {pending.text && <Reply text={pending.text} streaming={!pending.step} />}
            {pending.step && <Working label={pending.step} />}
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
