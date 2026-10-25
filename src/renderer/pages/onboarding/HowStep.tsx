/**
 * Onboarding 2/6 — how Dumbledore works, in three small pictures: it reads along while you
 * study, it writes the prompts for your AI, and it checks that what you learned stuck.
 */
import { Button, Kbd } from '@renderer/design-system'
import { Check } from 'lucide-react'
import { StepFrame } from './StepFrame'

function ReadsAlong() {
  return (
    <div className="dd-how__art" aria-hidden>
      <div className="dd-how__doc">
        <span style={{ width: '86%' }} />
        <span style={{ width: '72%' }} />
        <span className="dd-how__mark" style={{ width: '90%' }} />
        <span style={{ width: '64%' }} />
        <span style={{ width: '78%' }} />
      </div>
    </div>
  )
}

function WritesPrompts({ keyName }: { keyName: string }) {
  return (
    <div className="dd-how__art" aria-hidden>
      <div className="dd-how__chat">
        <div className="dd-how__prompt">
          I mix up SN1 and SN2. Explain the difference in 5 bullets, then quiz me…
        </div>
        <Kbd boxed>{keyName}</Kbd>
      </div>
    </div>
  )
}

function ChecksItStuck() {
  return (
    <div className="dd-how__art" aria-hidden>
      <div className="dd-how__quiz">
        <span className="dd-how__option" />
        <span className="dd-how__option dd-how__option--right">
          <Check size={12} strokeWidth={2.5} />
        </span>
        <span className="dd-how__option" />
      </div>
    </div>
  )
}

export function HowStep({
  keyName,
  onNext,
  onBack,
}: {
  keyName: string
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StepFrame
      step={1}
      wide
      title="How Dumbledore works"
      lead="You study the way you always do. Dumbledore does the remembering and the quizzing; your own AI does the teaching."
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <Button variant="primary" onClick={onNext} autoFocus>
          Set it up
        </Button>
      }
    >
      <ol className="dd-how">
        <li className="dd-how__card">
          <ReadsAlong />
          <div className="dd-how__title">It reads along</div>
          <p className="dd-how__text">
            Notes, PDFs, articles, lectures. It works out what you’re learning and where you get
            stuck, and keeps it in Memory.
          </p>
        </li>
        <li className="dd-how__card">
          <WritesPrompts keyName={keyName} />
          <div className="dd-how__title">It writes your prompts</div>
          <p className="dd-how__text">
            In ChatGPT, Claude or Gemini, tap {keyName} for a prompt that starts from what you
            already know. Hold it on a page or an answer to see what to read.
          </p>
        </li>
        <li className="dd-how__card">
          <ChecksItStuck />
          <div className="dd-how__title">It checks it stuck</div>
          <p className="dd-how__text">
            Short quizzes between steps, and reviews a few days later, so you remember it at exam
            time.
          </p>
        </li>
      </ol>
    </StepFrame>
  )
}
