/**
 * Onboarding 5/5 — learn the Dumbledore key by pressing it. A big keycap mirrors the key
 * (pressed while held, a press animation on every tap), a live line coaches ("That’s left ⌥ —
 * tap right ⌥…"), and a checklist explains tap (the prompt: written for what you studied last, the
 * next step, or yours rewritten), hold (tell Dumbledore what you want, it writes the prompt) and
 * double-tap (the chat).
 * Continue unlocks after the first clean tap. If right ⌥ is taken (Goldfish, Claude Desktop), the conflict note offers
 * right ⌘ instead.
 */
import { Button } from '@renderer/design-system'
import { DEFAULT_SETTINGS, type Settings } from '@shared/domain'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TRIGGER_KEYS } from '../settings/keys'
import { KeyConflictNote } from '../settings/ShortcutsSection'
import { StepFrame } from './StepFrame'
import { keyName, useKeyLesson, WHERE } from './useKeyLesson'

function Keycap({
  k,
  down,
  presses,
  good,
}: {
  k: Settings['shortcut']['key']
  down: boolean
  presses: number
  good: boolean
}) {
  const info = TRIGGER_KEYS[k]
  return (
    <div
      key={presses}
      className="dd-keycap"
      data-down={down}
      data-tone={good ? 'good' : undefined}
      data-pressed={presses > 0 ? 'true' : undefined}
      aria-hidden
    >
      <span className="dd-keycap__glyph">{info.glyph}</span>
      <span className="dd-keycap__word">{info.word}</span>
    </div>
  )
}

function Lesson({ done, title, children }: { done: boolean; title: string; children: string }) {
  return (
    <li className="dd-onb__lesson" data-done={done}>
      <span className="dd-onb__lesson-mark" aria-hidden>
        {done ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span>
        <span className="dd-onb__lesson-title">{title}</span>
        {children}
        <span className="dd-sr-only">{done ? ' — done' : ' — not yet'}</span>
      </span>
    </li>
  )
}

export function KeyStep({
  settings,
  onNext,
  onBack,
  onLearned,
}: {
  settings: Settings | undefined
  onNext: () => void
  onBack: () => void
  onLearned: () => void
}) {
  const shortcut = settings?.shortcut ?? DEFAULT_SETTINGS.shortcut
  const lesson = useKeyLesson(shortcut)
  const [helpOpen, setHelpOpen] = useState(false)
  const name = keyName(shortcut.key)
  useEffect(() => {
    if (lesson.tapped) onLearned()
  }, [lesson.tapped, onLearned])
  return (
    <StepFrame
      step={4}
      title="Meet the Dumbledore key"
      lead={`${name[0]?.toUpperCase()}${name.slice(1)} does the smart thing wherever you are. Tap it now: press and let go.`}
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <>
          {!lesson.tapped ? (
            <Button variant="ghost" onClick={onNext}>
              Skip for now
            </Button>
          ) : null}
          <Button variant="primary" onClick={onNext} disabled={!lesson.tapped}>
            Continue
          </Button>
        </>
      }
    >
      <div className="dd-onb__key-stage">
        <Keycap k={shortcut.key} down={lesson.down} presses={lesson.presses} good={lesson.tapped} />
        <div className="dd-onb__key-caption">
          {name} · {WHERE[shortcut.key]}
        </div>
        <div
          className="dd-onb__verdict"
          data-tone={lesson.verdict.tone}
          role="status"
          aria-live="polite"
        >
          {lesson.verdict.text}
        </div>
      </div>
      <ul className="dd-onb__lessons">
        <Lesson done={lesson.tapped} title="Tap">
          Writes the prompt in ChatGPT or any AI chat: for what you studied last, or the next step.
          Typed your own? It rewrites it (⌘Z undoes).
        </Lesson>
        <Lesson done={lesson.held} title="Hold">
          Tell Dumbledore what you want, it writes the prompt and pastes it into your AI chat.
        </Lesson>
        <Lesson done={lesson.doubled} title="Double-tap">
          Opens the chat with Dumbledore.
        </Lesson>
      </ul>
      {shortcut.key === 'rightOption' ? (
        helpOpen ? (
          <KeyConflictNote shortcut={shortcut} onResolved={() => setHelpOpen(false)} />
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
              Nothing happens, or another app reacts?
            </Button>
          </div>
        )
      ) : null}
    </StepFrame>
  )
}
