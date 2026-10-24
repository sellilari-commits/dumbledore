/**
 * The panel's subject and its picker state, read once in MiniPanel and passed down so the
 * header menu and the topic list always agree. Choosing a subject sets the focus subject
 * (settings.update), shown optimistically while it saves; "Follow the latest" clears it.
 */
import { useAction, useSettings, useSubjects } from '@renderer/lib/queries'
import type { SettingsPatch, SubjectSummary } from '@shared/domain'
import { report } from './panel-actions'
import { panelSubjects, pickSubject } from './topics'

export interface PanelSubject {
  subject: SubjectSummary | null
  /** The saved (or saving) focus subject; null = follow the latest. */
  focusId: string | null
  choices: SubjectSummary[]
  choose: (id: string | null) => void
  loading: boolean
  error: unknown
}

function pendingFocus(vars: SettingsPatch | undefined): string | null | undefined {
  return vars && 'focusSubjectId' in vars ? (vars.focusSubjectId ?? null) : undefined
}

export function usePanelSubject(): PanelSubject {
  const settings = useSettings()
  const subjects = useSubjects()
  const update = useAction('settings.update', { onError: report })
  const optimistic = update.isPending ? pendingFocus(update.variables) : undefined
  const focusId = optimistic === undefined ? (settings.data?.focusSubjectId ?? null) : optimistic
  const all = subjects.data ?? []
  const subject = pickSubject(all, focusId)
  const pool = panelSubjects(all)
  const choices = subject && !pool.includes(subject) ? [subject, ...pool] : pool
  return {
    subject,
    focusId,
    choices,
    choose: (id) => {
      if (id !== focusId) update.mutate({ focusSubjectId: id })
    },
    loading: subjects.isLoading || settings.isLoading,
    error: subjects.error ?? settings.error,
  }
}
