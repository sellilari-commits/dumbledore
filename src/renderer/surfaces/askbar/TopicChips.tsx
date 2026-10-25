/**
 * The topic chips above the Ask bar's input: one calm chip per topic (all of them, as the mini
 * panel lists them), one selected at a time. The chips wrap onto as many lines as they need; past
 * a few lines the block scrolls and the cut-off edge fades out. A faint subject name follows a
 * topic only when another subject has one with the same name. Chips never take focus from the
 * input (mousedown is swallowed), so ←/→ and ↵ keep working in it.
 */
import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Topic } from './useTopics'

interface Edges {
  top: boolean
  bottom: boolean
}

const keepFocus = (e: MouseEvent) => e.preventDefault()

export function TopicChips({
  topics,
  selectedId,
  onToggle,
}: {
  topics: Topic[]
  selectedId: string | null
  onToggle: (id: string) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edges>({ top: false, bottom: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((now) => (now.top === top && now.bottom === bottom ? now : { top, bottom }))
  }, [])

  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [measure])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the chips change
  useLayoutEffect(measure, [measure, topics])

  // Keep the selected chip in view (←/→ can move it past the edge).
  useEffect(() => {
    if (!selectedId) return
    const chips = track.current?.querySelectorAll<HTMLElement>('[data-topic]') ?? []
    const chip = Array.from(chips).find((c) => c.dataset.topic === selectedId)
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <div
      className="ask__topics"
      data-fade-top={edges.top || undefined}
      data-fade-bottom={edges.bottom || undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a block of toggle chips, not a form fieldset */}
      <div
        ref={track}
        className="ask__topics-track"
        role="group"
        aria-label="Topics"
        onScroll={measure}
      >
        {topics.map((t) => {
          const on = t.id === selectedId
          return (
            <button
              key={t.id}
              type="button"
              className="ask__topic"
              data-topic={t.id}
              aria-pressed={on}
              title={`${t.name} · ${t.subjectName}${on ? ' · click to deselect' : ''}`}
              onMouseDown={keepFocus}
              onClick={() => onToggle(t.id)}
            >
              <span className="ask__topic-name">{t.name}</span>
              {t.subjectLabel && <span className="ask__topic-subject">{t.subjectLabel}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
