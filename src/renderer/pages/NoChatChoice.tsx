/**
 * Sending a prompt to the student's AI from a page, without ever opening a website unasked.
 * `prompt.sendToChat` pastes into the open AI chat; with none open it opens nothing and says so
 * (`no-chat`), and the page shows the choice in place: "ChatGPT isn't open. [Open ChatGPT and
 * paste] [Copy]". Only a click on the button that says "Open …" opens the student's usual AI
 * (`prompt.openUsualAi`).
 */
import { Button, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import type { InvokeRes } from '@shared/ipc'
import { Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import './no-chat-choice.css'

export interface NoChat {
  /** The prompt that could not be pasted. */
  text: string
  /** The AI the student usually studies with; null when Dumbledore hasn't seen one yet. */
  usual: { name: string } | null
}

type Sent = InvokeRes<'prompt.sendToChat'>

/** What happened after "Open <AI> and paste": typed in, or on the clipboard. */
export function openedText(opened: { name: string; prefilled: boolean }): string {
  return opened.prefilled
    ? `Opened ${opened.name} with your prompt typed in — read it, then press Enter there.`
    : `Opened ${opened.name} — your prompt is copied: paste it with ⌘V.`
}

/**
 * `send(text, onSent)`: pastes into the open chat and calls `onSent` with the result (pasted or
 * failed); with no chat open it calls nothing and sets `noChat`, for <NoChatChoice>.
 */
export function useChatPrompt() {
  const send = useAction('prompt.sendToChat')
  const openUsual = useAction('prompt.openUsualAi')
  const copy = useAction('prompt.copy')
  const [noChat, setNoChat] = useState<NoChat | null>(null)

  return {
    noChat,
    sending: send.isPending,
    opening: openUsual.isPending,
    send(text: string, onSent: (r: Sent) => void) {
      send.mutate(text, {
        onSuccess: (r) => {
          if (!r.ok && r.reason === 'no-chat') return setNoChat({ text, usual: r.usual ?? null })
          setNoChat(null)
          onSent(r)
        },
        onError: (err) => errorToast(err),
      })
    },
    /** The click on "Open <AI> and paste". */
    open() {
      if (!noChat) return
      openUsual.mutate(noChat.text, {
        onSuccess: (r) => {
          setNoChat(null)
          if (r.opened) toast(openedText(r.opened), { tone: 'success', ttlMs: 8000 })
          else toast('No AI to open — copy the prompt instead.')
        },
        onError: (err) => errorToast(err),
      })
    },
    copy() {
      if (!noChat) return
      const name = noChat.usual?.name ?? 'your AI'
      copy.mutate(noChat.text, {
        onSuccess: () => {
          setNoChat(null)
          toast(`Prompt copied — paste it into ${name}`, { tone: 'success' })
        },
        onError: (err) => errorToast(err),
      })
    },
  }
}

export interface NoChatChoiceProps {
  noChat: NoChat
  onOpen: () => void
  onCopy: () => void
  opening?: boolean
  size?: 'xs' | 'sm'
}

/** "ChatGPT isn't open. [Open ChatGPT and paste] [Copy]", in place of a toast. */
export function NoChatChoice({ noChat, onOpen, onCopy, opening, size = 'sm' }: NoChatChoiceProps) {
  const { usual } = noChat
  const icon = size === 'xs' ? 12 : 14
  return (
    <fieldset className="dd-nochat" aria-label="No AI chat open">
      <span className="dd-nochat__text">
        {usual ? `${usual.name} isn’t open.` : 'No AI chat is open.'}
      </span>
      {usual ? (
        <Button size={size} icon={<ExternalLink size={icon} />} loading={opening} onClick={onOpen}>
          Open {usual.name} and paste
        </Button>
      ) : null}
      <Button size={size} variant="ghost" icon={<Copy size={icon} />} onClick={onCopy}>
        Copy
      </Button>
    </fieldset>
  )
}
