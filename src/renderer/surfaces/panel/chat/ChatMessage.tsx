/**
 * One chat message: the student's in a grey bubble on the right, Dumbledore's as markdown beside
 * the spectacles glyph with its action chips. StreamingMessage shows a reply as it streams in.
 */
import { SpectaclesGlyph, Spinner } from '@renderer/design-system'
import type { ChatMessage } from '@shared/domain'
import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionChips } from './ActionChips'

const MARKDOWN: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

function Reply({ children }: { children: ReactNode }) {
  return (
    <div className="pn-msg pn-msg--assistant">
      <span className="pn-msg__avatar" aria-hidden>
        <SpectaclesGlyph size={16} />
      </span>
      <div className="pn-msg__main">{children}</div>
    </div>
  )
}

function Md({ text }: { text: string }) {
  return (
    <div className="pn-md">
      <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
        {text}
      </Markdown>
    </div>
  )
}

export function ChatMessageView({ message }: { message: ChatMessage }) {
  if (message.role === 'user')
    return (
      <div className="pn-msg pn-msg--user">
        <div className="pn-msg__bubble">{message.content}</div>
      </div>
    )
  return (
    <Reply>
      <Md text={message.content} />
      <ActionChips actions={message.actions} />
    </Reply>
  )
}

export function StreamingMessage({ text }: { text: string }) {
  return (
    <Reply>
      {text ? (
        <div className="pn-streaming">
          <Md text={text} />
        </div>
      ) : (
        <div className="pn-thinking">
          <Spinner size={12} />
          <span>Thinking…</span>
        </div>
      )}
    </Reply>
  )
}
