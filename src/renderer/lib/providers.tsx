/**
 * Providers shared by the app and panel windows: one QueryClient, Radix tooltips, toasts and
 * the push-event subscription (memory/state/session → cache).
 */
import { Toaster, TooltipProvider } from '@renderer/design-system'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useLiveUpdates } from './live'

export function createQueryClient(opts: { retry?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: opts.retry ?? 1, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  })
}

function Live({ onNavigate }: { onNavigate?: (route: string) => void }) {
  useLiveUpdates(onNavigate)
  return null
}

export function Providers({
  client,
  children,
  onNavigate,
}: {
  client: QueryClient
  children: ReactNode
  onNavigate?: (route: string) => void
}) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Live onNavigate={onNavigate} />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
