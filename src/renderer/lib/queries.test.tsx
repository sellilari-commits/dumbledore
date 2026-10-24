/** Write channels refresh the read models they change (AFFECTS), e.g. coach actions. */
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { setApi } from './api'
import { createMockApi } from './mock-api'
import { createQueryClient } from './providers'
import { keys, useAction } from './queries'
import './test-utils'

describe('useAction', () => {
  it('coach.runAction refreshes the subject page, home and the session', async () => {
    setApi(createMockApi({ latencyMs: 0 }))
    const client = createQueryClient({ retry: 0 })
    const watched = [keys.subject('sub_orgo'), keys.home(), keys.session(), keys.subjects()]
    for (const key of watched) client.setQueryData(key, { stale: false })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useAction('coach.runAction'), { wrapper })
    await act(() =>
      result.current.mutateAsync({ type: 'start_roadmap', subjectId: 'sub_orgo', goal: 'SN2' }),
    )
    await waitFor(() =>
      expect(watched.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
        true,
        true,
        true,
        true,
      ]),
    )
  })
})
