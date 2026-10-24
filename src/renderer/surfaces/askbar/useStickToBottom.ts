/**
 * Keeps a scrolling log pinned to its newest content while it grows (streamed words, new
 * messages, the window catching up), unless the reader scrolled up to read; a new `pinKey`
 * (a question was just sent) pins it again.
 */
import { type RefObject, useLayoutEffect, useRef } from 'react'

/** How close to the bottom (px) still counts as reading the newest message. */
const SLACK = 24

export function useStickToBottom(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  pinKey: string | null,
): void {
  const stuck = useRef(true)

  useLayoutEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    let lastTop = el.scrollTop
    const follow = () => {
      if (stuck.current) el.scrollTop = el.scrollHeight
    }
    // Only a move up (the reader) unpins; growing content never does.
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance <= SLACK) stuck.current = true
      else if (el.scrollTop < lastTop) stuck.current = false
      lastTop = el.scrollTop
    }
    follow()
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow)
    observer?.observe(inner)
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [scroller, content])

  useLayoutEffect(() => {
    if (pinKey === null) return
    stuck.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [scroller, pinKey])
}
