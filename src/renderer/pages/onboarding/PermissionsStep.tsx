/**
 * Onboarding 2/5 — macOS permissions with live status. Each row flips to "✓ Granted" by
 * itself once macOS reports the switch (polled every second). Continue needs Accessibility;
 * Screen Recording is optional.
 */
import { Button, Tag } from '@renderer/design-system'
import { MousePointerClick, ScanText } from 'lucide-react'
import { PERMISSIONS, PermissionControl, usePermissionFlow } from '../settings/permissions'
import { StepFrame } from './StepFrame'

const ICONS = { accessibility: MousePointerClick, screenRecording: ScanText }

export function PermissionsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const flow = usePermissionFlow(true)
  const axOk = flow.granted('accessibility')
  const srOk = flow.granted('screenRecording')
  return (
    <StepFrame
      step={1}
      title="Let Dumbledore see your screen"
      lead="macOS asks once for each. Flip the switch for Dumbledore in System Settings — this page notices by itself."
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <>
          {!axOk ? (
            <Button variant="ghost" onClick={onNext}>
              Set up later
            </Button>
          ) : null}
          <Button variant="primary" onClick={onNext} disabled={!axOk}>
            Continue
          </Button>
        </>
      }
    >
      <div className="dd-onb__card">
        {PERMISSIONS.map((p) => {
          const Icon = ICONS[p.kind]
          return (
            <div className="dd-onb__row" key={p.kind}>
              <span className="dd-onb__row-icon" aria-hidden>
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <div className="dd-onb__row-text">
                <div className="dd-onb__row-title">
                  {p.title}
                  <Tag color={p.required ? 'blue' : 'gray'}>{p.required ? 'Required' : 'Optional'}</Tag>
                </div>
                <div className="dd-onb__row-desc">{p.description}</div>
              </div>
              <div className="dd-onb__row-side">
                <PermissionControl
                  title={p.title}
                  granted={flow.granted(p.kind)}
                  waiting={flow.isWaiting(p.kind)}
                  onOpen={() => flow.request(p.kind)}
                />
              </div>
            </div>
          )
        })}
      </div>
      {!srOk ? (
        <p className="dd-onb__hint">
          Screen Recording is optional. Without it Dumbledore reads text only, like most of the time
          anyway — you can switch it on later in Settings.
        </p>
      ) : null}
    </StepFrame>
  )
}
