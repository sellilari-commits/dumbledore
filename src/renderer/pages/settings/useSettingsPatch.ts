/**
 * Optimistic settings writes. `patch` sends a top-level partial to 'settings.update' (nested
 * objects must be passed whole — use the current value and spread it), shows the change at
 * once, rolls back with a toast if the write fails, and stores what main returns.
 */
import { toast } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { invalidateChannels, keys } from '@renderer/lib/queries'
import type { Settings, SettingsPatch } from '@shared/domain'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export function useSettingsPatch() {
  const qc = useQueryClient()
  const mutation = useMutation<Settings, Error, SettingsPatch, { prev: Settings | undefined }>({
    mutationFn: (patch) => invoke('settings.update', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.settings() })
      const prev = qc.getQueryData<Settings>(keys.settings())
      if (prev) qc.setQueryData<Settings>(keys.settings(), { ...prev, ...patch })
      return { prev }
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.settings(), ctx.prev)
      toast(`Couldn’t save that: ${err.message}`, { tone: 'error' })
    },
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings(), saved)
      invalidateChannels(qc, ['app.getState'])
    },
  })
  const { mutate } = mutation
  const patch = useCallback((p: SettingsPatch) => mutate(p), [mutate])
  return { patch, isPending: mutation.isPending }
}

/** Capture on/off goes through its own channel (it also starts/stops the helper). */
export function useCaptureSwitch() {
  const qc = useQueryClient()
  return useMutation<void, Error, boolean, { prev: Settings | undefined }>({
    mutationFn: (enabled) => invoke('capture.setEnabled', enabled),
    onMutate: async (enabled) => {
      await qc.cancelQueries({ queryKey: keys.settings() })
      const prev = qc.getQueryData<Settings>(keys.settings())
      if (prev) qc.setQueryData<Settings>(keys.settings(), { ...prev, captureEnabled: enabled })
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.settings(), ctx.prev)
      toast(`Couldn’t change capture: ${err.message}`, { tone: 'error' })
    },
    onSettled: () => invalidateChannels(qc, ['settings.get', 'app.getState']),
  })
}
