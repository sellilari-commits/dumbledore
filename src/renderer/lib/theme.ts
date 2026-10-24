/**
 * Light/dark theme. Settings.theme ('system' | 'light' | 'dark') maps to <html data-theme>;
 * 'system' removes the attribute so tokens.css follows prefers-color-scheme. A ?theme= URL
 * parameter overrides everything (screenshots).
 */
import type { Settings } from '@shared/domain'
import { useEffect } from 'react'

export type ThemeSetting = Settings['theme']

function urlTheme(): ThemeSetting | null {
  if (typeof window === 'undefined') return null
  const t = new URLSearchParams(window.location.search).get('theme')
  return t === 'light' || t === 'dark' || t === 'system' ? t : null
}

export function applyTheme(theme: ThemeSetting): void {
  const root = document.documentElement
  const chosen = urlTheme() ?? theme
  if (chosen === 'system') delete root.dataset.theme
  else root.dataset.theme = chosen
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** The theme actually on screen right now. */
export function effectiveTheme(): 'light' | 'dark' {
  const attr = document.documentElement.dataset.theme
  if (attr === 'light' || attr === 'dark') return attr
  return systemPrefersDark() ? 'dark' : 'light'
}

/** ⌘⇧L: flips what is on screen; returns the value to persist. */
export function nextTheme(): ThemeSetting {
  return effectiveTheme() === 'dark' ? 'light' : 'dark'
}

/** Keeps <html data-theme> in sync with settings (applies before data loads too). */
export function useThemeSync(theme: ThemeSetting | undefined): void {
  useEffect(() => {
    applyTheme(theme ?? 'system')
  }, [theme])
}
