/**
 * Runs the stored-secrets scrub (store/scrub.ts) when the repos support it (SqliteRepos does):
 * everything read from a window showing a secret file goes, and keys, tokens and passwords in
 * other stored text are masked. Cheap enough to run at every start.
 */
import type { Repos } from '../../contracts'
import { redactSecrets, secretFileInTitle } from '../../privacy'
import type { ScrubReport, ScrubSupport } from '../../store/scrub'

function scrubOf(repos: Repos): ScrubSupport | null {
  const candidate = (repos as Repos & { scrub?: ScrubSupport }).scrub
  return candidate && typeof candidate.secrets === 'function' ? candidate : null
}

/** Scrubs stored secrets; null when the repos cannot (in-memory test repos). */
export function scrubStoredSecrets(repos: Repos): ScrubReport | null {
  const scrub = scrubOf(repos)
  if (!scrub) return null
  return scrub.secrets({
    mask: redactSecrets,
    isSecretTitle: (title) => secretFileInTitle(title) !== null,
  })
}

/** True when the scrub changed anything worth announcing. */
export const scrubChanged = (r: ScrubReport | null): boolean =>
  r !== null && r.masked + r.removedEpisodes + r.removedEncounters + r.removedNotes > 0
