import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { encounterInput, episode } from '../../store/conformance/fixtures'
import { createSqliteRepos } from '../../store/sqlite-repos'
import { createMemoryRepos } from '../../testing/memory-repos'
import { scrubChanged, scrubStoredSecrets } from './scrub-secrets'

const GOOGLE_KEY = `AIza${'S'.repeat(35)}`
const envSource = { app: 'TextEdit', bundleId: 'com.apple.TextEdit', url: null, title: '.env' }
const pageSource = {
  app: 'Chrome',
  bundleId: 'com.google.Chrome',
  url: 'https://x.org',
  title: 'Notes',
}

function seed() {
  const repos = createSqliteRepos(':memory:', new FakeClock())
  repos.episodes.save(
    episode({
      id: 'epi_env',
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      url: null,
      title: '.env',
      text: 'NEO4J_PASSWORD=hunter2hunter2',
    }),
  )
  repos.episodes.save(episode({ id: 'epi_page', text: 'OPENAI_API_KEY=abcd1234efgh5678 and SN1' }))
  const envEnc = repos.encounters.add(
    encounterInput({ episodeId: 'epi_env', seen: `Key ${GOOGLE_KEY}`, source: envSource }),
  )
  const pageEnc = repos.encounters.add(
    encounterInput({
      episodeId: 'epi_page',
      seen: `SN1 notes, key ${GOOGLE_KEY}`,
      source: pageSource,
    }),
  )
  repos.notes.add({
    subjectId: null,
    conceptId: null,
    encounterId: envEnc.id,
    kind: 'highlight',
    text: GOOGLE_KEY,
    source: envSource,
  })
  repos.notes.add({
    subjectId: null,
    conceptId: null,
    encounterId: pageEnc.id,
    kind: 'fact',
    text: `SN1 is unimolecular; token=${'t'.repeat(12)}`,
    source: pageSource,
  })
  return { repos, envEnc, pageEnc }
}

describe('scrubStoredSecrets', () => {
  it('deletes what came from a secret file and masks secrets everywhere else', () => {
    const { repos, envEnc, pageEnc } = seed()
    const report = scrubStoredSecrets(repos)
    expect(report).toMatchObject({ removedEpisodes: 1, removedEncounters: 1, removedNotes: 1 })
    expect(scrubChanged(report)).toBe(true)

    expect(repos.episodes.get('epi_env')).toBeNull()
    const ids = repos.encounters.list({}).map((e) => e.id)
    expect(ids).not.toContain(envEnc.id)
    expect(ids).toContain(pageEnc.id)

    const dump = JSON.stringify([
      repos.episodes.get('epi_page'),
      repos.encounters.list({}),
      repos.db.prepare('SELECT text FROM notes').all(),
    ])
    expect(dump).not.toContain(GOOGLE_KEY)
    expect(dump).not.toMatch(/abcd1234|hunter2|tttttttttttt/)
    expect(dump).toContain('SN1')
    expect(repos.search.query(GOOGLE_KEY.slice(0, 12), 10)).toEqual([])
  })

  it('changes nothing the second time, and skips repos without scrub support', () => {
    const { repos } = seed()
    scrubStoredSecrets(repos)
    expect(scrubChanged(scrubStoredSecrets(repos))).toBe(false)
    expect(scrubStoredSecrets(createMemoryRepos(new FakeClock()))).toBeNull()
  })
})
