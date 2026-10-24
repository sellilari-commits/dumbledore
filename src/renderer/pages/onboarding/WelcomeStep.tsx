/** Onboarding 1/6 — welcome and the three privacy promises. */
import { Button, SpectaclesGlyph } from '@renderer/design-system'
import { EyeOff, HardDrive, ScanText } from 'lucide-react'
import { StepFrame } from './StepFrame'

const PROMISES = [
  {
    icon: HardDrive,
    title: 'Your memory stays on your Mac',
    text: 'Subjects, notes and exams live in a local folder, with no account. Only the text a question needs goes to your AI provider, with emails, numbers and passwords masked.',
  },
  {
    icon: ScanText,
    title: 'It reads text, never keeps screenshots',
    text: 'It reads what’s on screen and lets the pixels go right away.',
  },
  {
    icon: EyeOff,
    title: 'You choose what it sees',
    text: 'Pause it any time with ⌃⌥⌘P, and skip apps or sites in Settings.',
  },
]

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <StepFrame
      step={0}
      center
      art={
        <div className="dd-onb__mark" aria-hidden>
          <SpectaclesGlyph size={46} strokeWidth={1.5} />
        </div>
      }
      title="Meet Dumbledore"
      lead="A study coach that lives on your Mac. It notices what you’re learning, writes the prompts for your AI, and quizzes you so it sticks."
    >
      <ul className="dd-onb__promises">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <li className="dd-onb__promise" key={title}>
            <span className="dd-onb__promise-icon" aria-hidden>
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span>
              <div className="dd-onb__promise-title">{title}</div>
              <div className="dd-onb__promise-text">{text}</div>
            </span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onNext} autoFocus>
          Get started
        </Button>
      </div>
    </StepFrame>
  )
}
