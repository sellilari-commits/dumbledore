/**
 * DEPRECATED localStorage stub for "About you", from before the contract had profile channels.
 * Use `useProfile` / `useUpdateProfile` from ./queries (profile.get / profile.update) instead;
 * these exports stay only so nothing that still imports them breaks.
 */
import { useCallback, useState } from 'react'

const KEY = 'dumbledore.aboutYou'

export interface AboutYou {
  aboutMe: string
  level: string
  promptLanguage: 'auto' | 'en' | 'fi' | 'sv'
}

const EMPTY: AboutYou = { aboutMe: '', level: '', promptLanguage: 'auto' }

export function loadAboutYou(): AboutYou {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<AboutYou>) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function saveAboutYou(value: AboutYou): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode); nothing else to do in the stub.
  }
}

export function useAboutYou(): [AboutYou, (next: AboutYou) => void] {
  const [value, setValue] = useState<AboutYou>(loadAboutYou)
  const save = useCallback((next: AboutYou) => {
    setValue(next)
    saveAboutYou(next)
  }, [])
  return [value, save]
}
