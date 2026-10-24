/**
 * Pure helpers for the Inbox: filter values, which icon a source gets, the source meta line,
 * and whether an item still belongs in the current view after an action (optimistic hiding).
 */
import { formatSeconds, hostOf } from '@renderer/lib/format'
import type { Encounter, InboxState, SourceRef } from '@shared/domain'

export type StateFilter = InboxState | 'all'
/** null = every subject, UNFILED = items without a subject, otherwise a subject id. */
export type SubjectFilter = string | null
export const UNFILED = '__unfiled__'

export const STATE_TABS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Kept' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'all', label: 'All' },
]

export type InboxAction = 'accept' | 'ignore' | 'assign'

export type SourceKind = 'ai' | 'video' | 'document' | 'notes' | 'web'

const AI_APPS = /chatgpt|claude|gemini|copilot|perplexity/i
const AI_HOSTS = /(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai)$/
const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com)$/
const NOTE_APPS = /notion|obsidian|notes|onenote|bear|craft/i
const DOC_APPS = /preview|acrobat|pdf|word|pages|keynote|powerpoint|skim/i

export function sourceKind(source: SourceRef): SourceKind {
  const host = hostOf(source.url) ?? ''
  if (AI_APPS.test(source.app) || AI_HOSTS.test(host)) return 'ai'
  if (VIDEO_HOSTS.test(host)) return 'video'
  if (NOTE_APPS.test(source.app)) return 'notes'
  if (DOC_APPS.test(source.app) || /\.pdf$/i.test(source.title ?? '')) return 'document'
  return 'web'
}

/** "Google Chrome · en.wikipedia.org · 7 min" */
export function sourceMeta(e: Encounter): string {
  const parts = [e.source.app]
  const host = hostOf(e.source.url)
  if (host) parts.push(host)
  if (e.dwellSeconds > 0) parts.push(formatSeconds(e.dwellSeconds))
  return parts.join(' · ')
}

export function sourceTitle(e: Encounter): string {
  return e.source.title?.trim() || hostOf(e.source.url) || e.source.app
}

/** The state an item ends up in after an action. */
export function stateAfter(action: InboxAction): InboxState {
  return action === 'ignore' ? 'ignored' : 'accepted'
}

/** Whether an item is still shown in the current filters after the action. */
export function staysInView(
  e: Encounter,
  action: InboxAction,
  subjectId: string | null,
  filters: { state: StateFilter; subject: SubjectFilter },
): boolean {
  if (filters.state !== 'all' && filters.state !== stateAfter(action)) return false
  const nextSubject = action === 'assign' ? subjectId : e.subjectId
  if (filters.subject === UNFILED) return nextSubject === null
  if (filters.subject !== null) return nextSubject === filters.subject
  return true
}

export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso)
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}
