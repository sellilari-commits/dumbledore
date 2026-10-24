/**
 * The choose view's rows above the Ask bar input: recent subjects (emoji, name, what happens next)
 * and "New topic…". Hover or ↑/↓ highlights a row; ↵ on an empty input or a click picks it.
 */
import { Plus } from 'lucide-react'
import type { ChooseController } from './useChoose'
import './choose.css'

interface Props {
  choose: ChooseController
  /** ↵ would pick the highlighted row (the input is empty). */
  enterPicks: boolean
  onNewTopic: () => void
}

export function SubjectChoices({ choose, enterPicks, onNewTopic }: Props) {
  const { choices, highlight, setHighlight } = choose
  const enter = (i: number) =>
    enterPicks && highlight === i ? (
      <kbd className="ov-key ask__choice-key" aria-hidden>
        ↵
      </kbd>
    ) : null
  return (
    <div className="ask__choose">
      <p className="ask__choose-title">What do you want to study?</p>
      <div className="ask__choices">
        {choices.map((c, i) => (
          <button
            key={c.id}
            type="button"
            data-active={highlight === i || undefined}
            className="ask__choice"
            onMouseEnter={() => setHighlight(i)}
            onClick={() => choose.pick(c.id)}
          >
            <span className="ask__choice-icon" aria-hidden>
              {c.emoji}
            </span>
            <span className="ask__choice-name">{c.name}</span>
            <span className="ask__choice-hint">{c.hint}</span>
            {enter(i)}
          </button>
        ))}
        <button
          type="button"
          data-active={highlight === choices.length || undefined}
          className="ask__choice"
          onMouseEnter={() => setHighlight(choices.length)}
          onClick={onNewTopic}
        >
          <span className="ask__choice-icon ask__choice-icon--plus" aria-hidden>
            <Plus size={16} strokeWidth={1.75} />
          </span>
          <span className="ask__choice-name">New topic…</span>
          {enter(choices.length)}
        </button>
      </div>
    </div>
  )
}
