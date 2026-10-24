/**
 * First-run onboarding (PLAN F10, ~3 min), full window without the sidebar: Welcome + privacy
 * promise → How it works → Permissions (live ✓) → AI (Gemini) → What are you studying → Learn the key → done.
 * Finishing (or "Skip setup") saves onboardingDone through 'settings.update' and opens Home.
 * `?step=how|permissions|ai|study|key|done` opens a step directly (previews and screenshots).
 */
import { Button, toast } from '@renderer/design-system'
import { useAction, useSettings } from '@renderer/lib/queries'
import { useCallback, useState } from 'react'
import { useLocation } from 'wouter'
import { TRIGGER_KEYS } from '../settings/keys'
import { AiStep } from './AiStep'
import { DoneStep } from './DoneStep'
import { HowStep } from './HowStep'
import { KeyStep } from './KeyStep'
import { PermissionsStep } from './PermissionsStep'
import { StudyStep } from './StudyStep'
import { WelcomeStep } from './WelcomeStep'
import './onboarding.css'

export const STEPS = ['welcome', 'how', 'permissions', 'ai', 'study', 'key', 'done'] as const
export type StepId = (typeof STEPS)[number]

function stepFromUrl(): number {
  if (typeof window === 'undefined') return 0
  const wanted = new URLSearchParams(window.location.search).get('step')
  return Math.max(0, STEPS.indexOf(wanted as StepId))
}

export function OnboardingPage() {
  const [step, setStep] = useState(stepFromUrl)
  const [keyLearned, setKeyLearned] = useState(false)
  const settings = useSettings()
  const [, navigate] = useLocation()
  const save = useAction('settings.update', {
    onSuccess: () => navigate('/home'),
    onError: (err) => toast(`Couldn’t finish setup: ${err.message}`, { tone: 'error' }),
  })
  const finish = () => save.mutate({ onboardingDone: true })
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))
  const learned = useCallback(() => setKeyLearned(true), [])
  const id = STEPS[step] ?? 'welcome'
  return (
    <div className="dd-onb" data-step={id}>
      <header className="dd-onb__chrome">
        {id !== 'done' ? (
          <Button variant="ghost" size="sm" onClick={finish} disabled={save.isPending}>
            Skip setup
          </Button>
        ) : null}
      </header>
      <main className="dd-onb__scroll" key={id}>
        {id === 'welcome' ? <WelcomeStep onNext={next} /> : null}
        {id === 'how' ? (
          <HowStep
            keyName={TRIGGER_KEYS[settings.data?.shortcut.key ?? 'rightOption'].short}
            onNext={next}
            onBack={back}
          />
        ) : null}
        {id === 'permissions' ? <PermissionsStep onNext={next} onBack={back} /> : null}
        {id === 'ai' ? <AiStep onNext={next} onBack={back} /> : null}
        {id === 'study' ? <StudyStep onNext={next} onBack={back} /> : null}
        {id === 'key' ? (
          <KeyStep settings={settings.data} onNext={next} onBack={back} onLearned={learned} />
        ) : null}
        {id === 'done' ? (
          <DoneStep
            settings={settings.data}
            keyLearned={keyLearned}
            finishing={save.isPending}
            onFinish={finish}
            onBack={back}
          />
        ) : null}
      </main>
    </div>
  )
}
