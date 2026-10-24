/**
 * RouteLink: a real link to an app route ("#/subjects/…") that navigates through the router on a
 * plain click, so it works with the hash router in the app and the memory router in tests.
 */
import type { ComponentProps, MouseEvent } from 'react'
import { useLocation } from 'wouter'

export interface RouteLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  to: string
}

export function RouteLink({ to, onClick, children, ...rest }: RouteLinkProps) {
  const [, navigate] = useLocation()
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={`#${to}`} onClick={go} {...rest}>
      {children}
    </a>
  )
}
