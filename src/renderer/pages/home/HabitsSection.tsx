/**
 * Home → Prompting habits: how often the student's own AI prompts give context, ask for
 * structure, examples or a quiz (share of prompts seen), plus one tip for the weakest habit.
 */
import { Callout, ProgressBar, Section } from '@renderer/design-system'
import { formatPercent } from '@renderer/lib/format'
import type { PromptHabits } from '@shared/domain'
import { MessageSquareText } from 'lucide-react'
import { habitRows, weakestHabit } from './home-utils'

export function HabitsSection({ habits }: { habits: PromptHabits }) {
  const rows = habitRows(habits)
  const weakest = weakestHabit(rows)
  return (
    <Section
      id="home-habits"
      title="Prompting habits"
      icon={<MessageSquareText size={14} strokeWidth={1.75} />}
      actions={
        habits.promptsSeen > 0 ? (
          <span className="hm-section-meta">
            from {habits.promptsSeen} prompt{habits.promptsSeen === 1 ? '' : 's'}
          </span>
        ) : null
      }
    >
      {habits.promptsSeen === 0 ? (
        <p className="hm-quiet">
          Once you ask an AI chat a few questions, Dumbledore shows what makes your prompts work.
        </p>
      ) : (
        <>
          <ul className="hm-habits">
            {rows.map((r) => (
              <li key={r.key} className="hm-habits__row">
                <span className="hm-habits__label">{r.label}</span>
                <ProgressBar value={r.share} label={r.label} />
                <span className="hm-habits__value" title={`${r.count} of ${habits.promptsSeen}`}>
                  {formatPercent(r.share)}
                </span>
              </li>
            ))}
          </ul>
          {weakest ? (
            <Callout icon="💡" className="hm-tip">
              <span>
                <strong>{weakest.label}.</strong> {weakest.tip}
              </span>
            </Callout>
          ) : null}
        </>
      )}
    </Section>
  )
}
