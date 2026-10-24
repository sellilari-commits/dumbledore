/**
 * RoadmapItem: a learn step as a Notion to-do that expands to show its objective, teaching
 * move and prompt (Copy / Send to chat); a checkpoint as a callout with its question count,
 * carried ideas and score.
 */

import { MOVE_LABEL } from '@renderer/lib/status'
import type { RoadmapItem as Item } from '@shared/domain'
import { ChevronRight, Copy, Send } from 'lucide-react'
import { useState } from 'react'
import '../styles/learning.css'
import { Button } from './Button'
import { Callout } from './Callout'
import { Checkbox } from './Checkbox'
import { Tag } from './Tag'

export interface RoadmapItemProps {
  item: Item
  /** Concepts carried from earlier misses (shown on checkpoints that re-test them). */
  carry?: string[]
  onCopy?: (prompt: string) => void
  onSendToChat?: (prompt: string) => void
  onTakeQuiz?: () => void
  defaultOpen?: boolean
}

export function RoadmapItem({
  item,
  carry = [],
  onCopy,
  onSendToChat,
  onTakeQuiz,
  defaultOpen = false,
}: RoadmapItemProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (item.kind === 'checkpoint') {
    const carried = carry.filter((c) => item.covers.includes(c))
    const scoreText =
      item.score === null ? null : `${Math.round(item.score * item.nQuestions)}/${item.nQuestions}`
    return (
      <div className="dd-rm-checkpoint" data-status={item.status}>
        <Callout
          icon={item.status === 'done' ? '✅' : '💡'}
          color={item.status === 'current' ? 'blue' : 'default'}
        >
          <div className="dd-rm-checkpoint__line">
            <strong>{item.title}</strong>
            <span className="dd-rm-checkpoint__sub">
              · {item.nQuestions} questions
              {carried.length > 0
                ? ` · carries ${carried.length} missed idea${carried.length > 1 ? 's' : ''}`
                : ''}
            </span>
            {scoreText ? (
              <Tag color={item.score !== null && item.score >= 0.8 ? 'green' : 'yellow'}>
                {scoreText}
              </Tag>
            ) : null}
            {item.status === 'current' && onTakeQuiz ? (
              <Button
                size="sm"
                variant="primary"
                onClick={onTakeQuiz}
                style={{ marginLeft: 'auto' }}
              >
                Take the quiz
              </Button>
            ) : null}
          </div>
          {carried.length > 0 && item.status !== 'done' ? (
            <div className="dd-rm-checkpoint__sub">
              Re-tests {carried.join(', ')} with a new question.
            </div>
          ) : null}
        </Callout>
      </div>
    )
  }

  const prompt = item.promptDraft
  return (
    <div className="dd-rm" data-status={item.status} data-open={open}>
      <div className="dd-rm__row">
        <button
          type="button"
          className="dd-rm__chevron"
          aria-label={open ? `Hide details for ${item.title}` : `Show details for ${item.title}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <Checkbox checked={item.status === 'done'} label={item.title} className="dd-rm__check" />
        <button type="button" className="dd-rm__title" onClick={() => setOpen(!open)}>
          {item.title}
        </button>
        <span className="dd-rm__aside">
          {item.status === 'current' ? <Tag color="blue">Current step</Tag> : null}
          {item.status === 'skipped' ? <Tag color="gray">Skipped</Tag> : null}
          {item.status === 'current' && onSendToChat ? (
            <span className="dd-rm__hover">
              <Button
                size="sm"
                variant="ghost"
                icon={<Send size={14} />}
                onClick={() => onSendToChat(prompt)}
              >
                Continue in chat
              </Button>
            </span>
          ) : null}
        </span>
      </div>
      {open ? (
        <div className="dd-rm__detail">
          <div className="dd-rm__objective">
            <Tag>{MOVE_LABEL[item.move]}</Tag>
            <span>{item.objective}</span>
          </div>
          <div className="dd-prompt">
            <span className="dd-prompt__label">Prompt for your AI</span>
            {prompt}
          </div>
          <div className="dd-prompt__actions">
            {onCopy ? (
              <Button size="sm" icon={<Copy size={14} />} onClick={() => onCopy(prompt)}>
                Copy
              </Button>
            ) : null}
            {onSendToChat ? (
              <Button size="sm" icon={<Send size={14} />} onClick={() => onSendToChat(prompt)}>
                Send to chat
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
