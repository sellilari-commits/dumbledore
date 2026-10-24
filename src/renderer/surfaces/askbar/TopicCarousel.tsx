/**
 * The topic row above the Ask bar's input: one calm chip per recent subject, one selected at a
 * time. When the chips overflow the width the row scrolls sideways (trackpad, shift-scroll, or a
 * plain wheel), the cut-off edge fades out and a small ‹ / › button pages that way. Chips never
 * take focus from the input (mousedown is swallowed), so ←/→ and ↵ keep working in it.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Topic } from './useTopics'

interface Edges {
  left: boolean
  right: boolean
}

const keepFocus = (e: MouseEvent) => e.preventDefault()

export function TopicCarousel({
  topics,
  selectedId,
  onToggle,
}: {
  topics: Topic[]
  selectedId: string | null
  onToggle: (id: string) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edges>({ left: false, right: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((now) => (now.left === left && now.right === right ? now : { left, right }))
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

  // A plain (vertical) wheel scrolls the row sideways; trackpads and shift-scroll already do.
  useEffect(() => {
    const el = track.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the selected chip in view (←/→ can move it off the edge).
  useEffect(() => {
    if (!selectedId) return
    const chips = track.current?.querySelectorAll<HTMLElement>('[data-topic]') ?? []
    const chip = Array.from(chips).find((c) => c.dataset.topic === selectedId)
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const page = (dir: -1 | 1) => {
    const el = track.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  return (
    <div
      className="ask__topics"
      data-fade-left={edges.left || undefined}
      data-fade-right={edges.right || undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a scrolling row of toggle chips, not a form fieldset */}
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
              title={on ? `${t.name} · click to deselect` : t.name}
              onMouseDown={keepFocus}
              onClick={() => onToggle(t.id)}
            >
              {t.emoji && (
                <span className="ask__topic-emoji" aria-hidden>
                  {t.emoji}
                </span>
              )}
              <span className="ask__topic-name">{t.name}</span>
            </button>
          )
        })}
      </div>
      {edges.left && (
        <button
          type="button"
          className="ask__topics-arrow ask__topics-arrow--prev"
          aria-label="Earlier topics"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={14} strokeWidth={2} aria-hidden />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          className="ask__topics-arrow ask__topics-arrow--next"
          aria-label="More topics"
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => page(1)}
        >
          <ChevronRight size={14} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  )
}
