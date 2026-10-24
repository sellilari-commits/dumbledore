/**
 * Onboarding 4/6 — the AI. Gemini 3.5 is checked by itself on arrival: in development it is
 * ready with the Hugo project's key ("Using key from Hugo project"); otherwise the student
 * pastes a key, which is saved to the Keychain and re-checked. The keyless fallbacks are named
 * so nobody feels stuck without a key.
 */
import { Button, Tag } from '@renderer/design-system'
import { useSettings } from '@renderer/lib/queries'
import { LifeBuoy, Sparkles } from 'lucide-react'
import { GeminiStatusLine, useGeminiStatus } from '../settings/GeminiRow'
import { KeyForm } from '../settings/KeyForm'
import { StepFrame } from './StepFrame'

export function AiStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const settings = useSettings()
  const keySet = settings.data?.ai.geminiKeySet ?? false
  const { state, retest, testing } = useGeminiStatus(keySet)
  const ready = state.kind === 'ready'
  const needsKey = state.kind === 'missing' || state.kind === 'failed'
  return (
    <StepFrame
      step={3}
      title={ready ? 'Your AI is ready' : 'Connect an AI'}
      lead="Gemini 3.5 plans your roadmaps, writes the prompts and builds the quizzes. Text is redacted before it leaves your Mac."
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <>
          {!ready ? (
            <Button variant="ghost" onClick={onNext}>
              Set up later
            </Button>
          ) : null}
          <Button variant="primary" onClick={onNext} disabled={!ready}>
            Continue
          </Button>
        </>
      }
    >
      <div className="dd-onb__card">
        <div className="dd-onb__row">
          <span className="dd-onb__row-icon" aria-hidden>
            <Sparkles size={16} strokeWidth={1.75} />
          </span>
          <div className="dd-onb__row-text">
            <div className="dd-onb__row-title">
              Gemini 3.5 <Tag color="blue">Primary</Tag>
            </div>
            <div className="dd-onb__row-desc dd-onb__status" aria-live="polite">
              <GeminiStatusLine state={state} />
            </div>
            {needsKey ? (
              <div className="dd-onb__form">
                <KeyForm
                  id="gemini"
                  name="Gemini"
                  placeholder="Paste your Gemini API key"
                  width={280}
                />
              </div>
            ) : null}
          </div>
          {state.kind === 'ready' ? (
            <div className="dd-onb__row-side">
              <Button size="sm" onClick={retest} loading={testing} aria-label="Test Gemini again">
                Test
              </Button>
            </div>
          ) : null}
        </div>
        <div className="dd-onb__row">
          <span className="dd-onb__row-icon" aria-hidden>
            <LifeBuoy size={16} strokeWidth={1.75} />
          </span>
          <div className="dd-onb__row-text">
            <div className="dd-onb__row-title">
              Free fallbacks <Tag color="gray">No key</Tag>
            </div>
            <div className="dd-onb__row-desc">
              Apple’s on-device model and OVHcloud step in when Gemini is busy. Groq and Mistral
              keys can be added later in Settings → AI providers.
            </div>
          </div>
        </div>
      </div>
      {needsKey ? (
        <p className="dd-onb__hint">
          Your key goes to the macOS Keychain and is never shown again. No key yet? Set up later —
          the free fallbacks keep things working.
        </p>
      ) : null}
    </StepFrame>
  )
}
