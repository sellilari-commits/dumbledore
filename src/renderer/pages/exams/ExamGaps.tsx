/**
 * "Your gaps" on the results page: one row per missed concept (what the student picked, or the
 * engine's diagnosis in words, plus links to the questions), the repair prompt, and the two ways
 * to hand it to the student's AI — Explore with <their AI> (pasted into the open chat; never sent)
 * or Copy prompt. With no chat open nothing opens: "ChatGPT isn't open. [Open ChatGPT and paste]
 * [Copy]" shows under the buttons, and only that labelled button opens the site.
 */
import { Button, Callout, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { Copy, Lightbulb, Send } from 'lucide-react'
import { NoChatChoice, useChatPrompt } from '../NoChatChoice'
import type { GapRow } from './exam-utils'
import './exam-page.css'

/** "you picked “DMSO”" · "Primary carbocations are most stable" · both, joined by "; ". */
function gapDetail(g: GapRow): string {
  const picked = g.picked.map((p) => `“${p}”`).join(' and ')
  return [...(picked ? [`you picked ${picked}`] : []), ...g.notes].join('; ')
}

export interface ExamGapsProps {
  rows: GapRow[]
  /** The repair prompt from 'quiz.finish'; null hides the prompt and its actions. */
  prompt: string | null
  /** The student's AI: the open chat, else the one they usually use ("Claude"), else "your AI". */
  assistant: string
  /** Opens "Review your answers" at question n (1-based). */
  onShowQuestion: (n: number) => void
}

export function ExamGaps({ rows, prompt, assistant, onShowQuestion }: ExamGapsProps) {
  const chat = useChatPrompt()
  const copy = useAction('prompt.copy')

  const copyPrompt = () => {
    if (!prompt) return
    copy.mutate(prompt, {
      onSuccess: () => toast(`Prompt copied — paste it into ${assistant}`, { tone: 'success' }),
      onError: (err) => errorToast(err),
    })
  }
  const explore = () => {
    if (!prompt) return
    chat.send(prompt, (res) =>
      res.ok
        ? toast(`Pasted into ${assistant} — read it, then press Enter there.`, { tone: 'success' })
        : toast(res.reason ?? `Couldn’t reach ${assistant}.`, {
            tone: 'error',
            action: { label: 'Copy instead', onClick: copyPrompt },
            ttlMs: 8000,
          }),
    )
  }

  return (
    <Callout icon={<Lightbulb size={18} strokeWidth={1.75} />} title="Your gaps">
      <ul className="ex-gaps">
        {rows.map((g) => {
          const detail = gapDetail(g)
          return (
            <li key={g.concept}>
              <strong>{g.concept}</strong>
              {detail ? <span className="ex-gaps__detail"> — {detail}</span> : null}
              {g.questions.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="ex-gaps__ref"
                  aria-label={`Show question ${n}`}
                  onClick={() => onShowQuestion(n)}
                >
                  Q{n}
                </button>
              ))}
            </li>
          )
        })}
      </ul>
      {prompt ? (
        <>
          <div className="dd-prompt">
            <span className="dd-prompt__label">Prompt for {assistant}</span>
            {prompt}
          </div>
          <div className="ex-actions">
            <Button
              variant="primary"
              size="sm"
              icon={<Send size={14} />}
              loading={chat.sending}
              onClick={explore}
            >
              Explore with {assistant}
            </Button>
            <Button size="sm" icon={<Copy size={14} />} onClick={copyPrompt}>
              Copy prompt
            </Button>
          </div>
          {chat.noChat ? (
            <NoChatChoice
              noChat={chat.noChat}
              opening={chat.opening}
              onOpen={chat.open}
              onCopy={chat.copy}
            />
          ) : null}
        </>
      ) : null}
    </Callout>
  )
}
