/**
 * The Ask bar: a Spotlight-like 560×52 input with the spectacles glyph. Enter sends the question
 * to the cheap LLM (`ask.submit`); the markdown reply (streamed when 'chat.delta' arrives) and
 * action chips expand below while the window grows to fit. Esc closes and returns focus.
 */
import type { DumbledoreApi } from '@shared/ipc'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SpectaclesGlyph } from '../overlay/glyph/SpectaclesGlyph'
import { ActionChips } from './ActionChips'
import { type AskController, useAsk } from './useAsk'
import { useWindowAutoSize } from './useWindowAutoSize'
import './askbar.css'

export const PLACEHOLDER = 'Ask Dumbledore — e.g. ‘I don’t get recursion’'

export function AskBar({ api }: { api: DumbledoreApi }) {
  const ask = useAsk(api)
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useWindowAutoSize(api, card)

  // Esc closes from anywhere; coming back to the window re-selects the question.
  const { close } = ask
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onFocus = () => {
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', onFocus)
    }
  }, [close])

  const { phase } = ask.view
  return (
    <div className="ask" ref={card} data-phase={phase}>
      <div className="ask__bar">
        <SpectaclesGlyph className="ask__glyph" size={22} />
        <input
          ref={input}
          className="ask__input"
          value={text}
          placeholder={PLACEHOLDER}
          aria-label="Ask Dumbledore"
          // biome-ignore lint/a11y/noAutofocus: the bar exists to be typed into the moment it opens
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            if (!e.target.value.trim() && phase !== 'loading') ask.reset()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ask.submit(text)
            }
          }}
        />
        {phase === 'loading' ? (
          <span className="ov-spinner" role="status" aria-label="Thinking" />
        ) : (
          text.trim() && (
            <kbd className="ov-key ask__enter" aria-hidden>
              ↵
            </kbd>
          )
        )}
      </div>
      {phase !== 'idle' && <AskAnswer ask={ask} />}
    </div>
  )
}

const MARKDOWN: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

function AskAnswer({ ask }: { ask: AskController }) {
  const { view } = ask
  const text = view.result?.reply ?? view.streamed
  return (
    <div className="ask__answer" aria-live="polite">
      {view.phase === 'loading' && !text && <p className="ask__thinking">Thinking…</p>}
      {text && (
        <div className="ask__reply" data-streaming={view.phase === 'loading' || undefined}>
          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
            {text}
          </Markdown>
        </div>
      )}
      {view.phase === 'error' && (
        <p className="ask__error" role="alert">
          {view.error ?? 'Something went wrong.'} Press ↵ to try again.
        </p>
      )}
      {view.result?.pasted && (
        <p className="ask__pasted">
          <Check size={14} aria-hidden /> Pasted into the chat box
        </p>
      )}
      {view.result && <ActionChips actions={view.result.actions} onRun={ask.runAction} />}
    </div>
  )
}
