/**
 * Test harness: a real Brain wired to FakeBackends (Groq, OVHcloud, Apple), a FakeClock and the
 * in-memory usage repo, with explicit routes so every test knows which fake answers.
 */
import type { ModelRoute } from '@shared/llm'
import { FakeClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { type BrainDeps, createBrain } from '../brain'
import { FakeBackend } from './fake-backend'

export const R = {
  groq: { provider: 'groq', model: 'openai/gpt-oss-120b' } as ModelRoute,
  ovh: { provider: 'ovh', model: 'gpt-oss-120b' } as ModelRoute,
  apple: { provider: 'apple', model: 'system' } as ModelRoute,
}

export function brainHarness(routes: ModelRoute[] = [R.groq], deps: Partial<BrainDeps> = {}) {
  const clock = new FakeClock('2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const groq = new FakeBackend('groq')
  const ovh = new FakeBackend('ovh')
  const apple = new FakeBackend('apple')
  const brain = createBrain({
    clock,
    usage: repos.usage,
    backends: { groq, ovh, apple, mistral: new FakeBackend('mistral') },
    routes: () => routes,
    cache: null,
    ...deps,
  })
  /** The user message of the n-th request to a backend. */
  const userOf = (b: FakeBackend, n = 0) => b.requests[n]?.messages.at(-1)?.content ?? ''
  return { clock, repos, groq, ovh, apple, brain, userOf }
}
