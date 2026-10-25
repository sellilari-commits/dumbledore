/**
 * The Ask bar conversation: the student's questions as grey bubbles on the right, Dumbledore's
 * markdown replies with their action chips on the left, the reply being written (streamed) and
 * the last error. It stays on the newest message unless the student scrolled up to read.
 * Dumbledore's own answers are saved only when the student chooses: "Save to subject" puts the
 * answer (without its "Saved to …" receipt lines) as a note on the current topic.
 * What a chat tool wrote shows as receipt rows under the reply (Receipts.tsx); a line of the reply
 * that only repeats one of them is left out of the text. Links in a reply (e.g. a web search's
 * "Sources: [title](url) · …") open only when clicked, in the default browser: they are
 * target=_blank anchors, which main's window open handler sends to shell.openExternal
 * (src/main/security.ts; navigating the window away is refused there too). Only http(s) and
 * mailto links are links; anything else stays plain text.
 */
import type { CoachAction } from '@shared/domain'
import { BookmarkPlus, Check } from 'lucide-react'
import { memo, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionChips } from './ActionChips'
import { isReceipt, Receipts } from './Receipts'
import type { AskController, AskError, AskMessage } from './useAsk'
import { useStickToBottom } from './useStickToBottom'

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
  onRun: AskController['runAction']
  onRunInPlace: AskController['runInPlace']
}

/** Receipt lines the chat adds under a reply; never part of a saved answer. */
const RECEIPT = /^(Saved to |Not saved: )/

/** The answer as a note: the reply without its receipts, at most 1000 characters. */
export function answerNote(content: string): string {
  const text = content
    .split(/\n{2,}/)
    .filter((p) => !RECEIPT.test(p.trim()))
    .join('\n\n')
    .trim()
  return text.length <= 1000 ? text : `${text.slice(0, 999).trimEnd()}…`
}

function SaveAnswer({ content, onRun }: { content: string; onRun: MessageProps['onRun'] }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle')
  const text = answerNote(content)
  if (!text) return null
  if (state === 'saved')
    return (
      <p className="ask__pasted">
        <Check size={14} aria-hidden /> Saved to your subject
      </p>
    )
  const save: CoachAction = { type: 'add_note', text, subjectId: null, conceptId: null }
  return (
    <div className="ask__actions">
      <button
        type="button"
        className="ask__chip"
        aria-disabled={state === 'busy' || undefined}
        onClick={() => {
          if (state !== 'idle') return
          setState('busy')
          onRun(save).then(
            (ok) => setState(ok ? 'saved' : 'idle'),
            () => setState('idle'),
          )
        }}
      >
        <BookmarkPlus size={14} strokeWidth={1.75} aria-hidden />
        <span>Save to subject</span>
      </button>
    </div>
  )
}

/** Memoised: while a reply streams in, only the streaming bubble re-renders. */
const Message = memo(function Message({ message, onRun, onRunInPlace }: MessageProps) {
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
      <ActionChips actions={message.actions} onRun={onRun} onRunInPlace={onRunInPlace} />
      {text && !message.pasted ? <SaveAnswer content={text} onRun={onRun} /> : null}
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
          <Message key={m.id} message={m} onRun={chat.runAction} onRunInPlace={chat.runInPlace} />
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
