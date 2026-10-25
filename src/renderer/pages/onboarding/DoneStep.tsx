/**
 * Onboarding — the final screen: a checklist of what is set up (each item honest about what was
 * skipped, with where to finish it), the first thing to try, and "Start studying", which marks
 * onboarding done ('settings.update') and opens Home.
 */
import { Button, SpectaclesGlyph } from '@renderer/design-system'
import { formatCount } from '@renderer/lib/format'
import { usePermissions, useSubjects } from '@renderer/lib/queries'
import type { Settings } from '@shared/domain'
import { Check, Minus } from 'lucide-react'
import { useGeminiStatus } from '../settings/GeminiRow'
import { StepFrame } from './StepFrame'
import { keyName } from './useKeyLesson'

function Item({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <li className="dd-onb__done-item" data-ok={ok}>
      <span className="dd-onb__lesson-mark" aria-hidden>
        {ok ? <Check size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}
      </span>
      <span>
        <span className="dd-onb__lesson-title">{title}</span>
        {text}
      </span>
    </li>
  )
}

export function DoneStep({
  settings,
  keyLearned,
  finishing,
  onFinish,
  onBack,
}: {
  settings: Settings | undefined
  keyLearned: boolean
  finishing: boolean
  onFinish: () => void
  onBack: () => void
}) {
  const permissions = usePermissions()
  const subjects = useSubjects()
  const gemini = useGeminiStatus(settings?.ai.geminiKeySet ?? false)
  const key = keyName(settings?.shortcut.key ?? 'rightOption')
  const axOk = permissions.data?.accessibility === true
  const count = (subjects.data ?? []).filter((s) => s.status === 'active').length
  const aiOk = gemini.state.kind === 'ready'
  return (
    <StepFrame
      step={6}
      center
      art={
        <div className="dd-onb__mark" aria-hidden>
          <SpectaclesGlyph size={46} strokeWidth={1.5} />
        </div>
      }
      title="You’re all set"
      lead="Dumbledore now sits on the right edge of your screen. It stays quiet until it can help."
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <Button variant="primary" onClick={onFinish} loading={finishing}>
          Start studying
        </Button>
      }
    >
      <ul className="dd-onb__done">
        <Item
          ok={axOk}
          title="Screen reading"
          text={
            axOk ? 'Accessibility is on.' : 'Turn on Accessibility later in Settings → Capture.'
          }
        />
        <Item
          ok={aiOk}
          title="AI"
          text={
            aiOk ? 'Gemini 3.5 is ready.' : 'Free fallbacks for now — add a key in Settings → AI.'
          }
        />
        <Item
          ok={count > 0}
          title="Subjects"
          text={
            count > 0
              ? `${formatCount(count, 'subject')} to start with.`
              : 'Dumbledore will suggest some from what you read.'
          }
        />
        <Item
          ok={keyLearned}
          title="The key"
          text={
            keyLearned
              ? `You know ${key}.`
              : `Tap ${key} any time; Settings → Shortcuts has the details.`
          }
        />
      </ul>
      <div className="dd-onb__try">
        <span className="dd-onb__try-label">Try it now</span>
        Open your AI chat (ChatGPT, Claude, Gemini…) and tap {key} for your next prompt. Hold it on
        an article to see what to read, and double-tap to talk to Dumbledore.
      </div>
    </StepFrame>
  )
}
