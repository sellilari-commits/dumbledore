/**
 * Gemini 3.5, the primary provider: a live status from a cached 'providers.test' check, so it
 * reads "✓ Using key from Hugo project" in development (no saved key, but the dev env file has
 * one), "✓ Connected" with a saved key, or asks for a key. Shared with onboarding's AI step.
 */
import { Button, Spinner, Tag } from '@renderer/design-system'
import { useProviderCheck } from '@renderer/lib/queries'
import { useState } from 'react'
import { KeyForm } from './KeyForm'
import { OkLabel, SettingsRow } from './ui'

export const GEMINI_KEY_HINT = 'Get a key at aistudio.google.com → Get API key.'

export type GeminiState =
  | { kind: 'checking' }
  | { kind: 'ready'; source: 'saved' | 'env'; latencyMs: number | null }
  | { kind: 'missing' }
  | { kind: 'failed'; error: string }

export function useGeminiStatus(keySet: boolean) {
  const check = useProviderCheck('gemini')
  let state: GeminiState
  if (check.isPending) state = { kind: 'checking' }
  else if (check.isError) state = { kind: 'failed', error: check.error.message }
  else if (check.data.ok)
    state = { kind: 'ready', source: keySet ? 'saved' : 'env', latencyMs: check.data.latencyMs }
  else if (!keySet) state = { kind: 'missing' }
  else state = { kind: 'failed', error: check.data.error ?? 'Gemini didn’t answer.' }
  return { state, retest: () => void check.refetch(), testing: check.isFetching }
}

const ms = (n: number | null) => (n === null ? '' : ` · ${n} ms`)

export function GeminiStatusLine({ state }: { state: GeminiState }) {
  switch (state.kind) {
    case 'checking':
      return (
        <span className="dd-set-muted dd-set-inline">
          <Spinner size={12} /> Checking for a key…
        </span>
      )
    case 'ready':
      return (
        <OkLabel>
          {state.source === 'env' ? 'Using key from Hugo project' : 'Connected'}
          {ms(state.latencyMs)}
        </OkLabel>
      )
    case 'missing':
      return <span className="dd-set-muted">No key yet. {GEMINI_KEY_HINT}</span>
    case 'failed':
      return (
        <span className="dd-set-bad" role="alert">
          {state.error}
        </span>
      )
  }
}

export function GeminiRow({ keySet }: { keySet: boolean }) {
  const { state, retest, testing } = useGeminiStatus(keySet)
  const [editing, setEditing] = useState(false)
  const showForm = editing || state.kind === 'missing'
  return (
    <SettingsRow
      label={
        <>
          Gemini 3.5 <Tag color="blue">Primary</Tag>
        </>
      }
      description={
        <>
          Plans roadmaps, writes your prompts and builds quizzes.
          <span className="dd-set-status">
            <GeminiStatusLine state={state} />
          </span>
        </>
      }
    >
      {showForm ? (
        <KeyForm
          id="gemini"
          name="Gemini"
          placeholder="AIza…"
          autoFocus={editing}
          onSaved={() => setEditing(false)}
          onCancel={editing ? () => setEditing(false) : undefined}
        />
      ) : (
        <>
          {state.kind !== 'checking' ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {keySet ? 'Replace key' : 'Use my own key'}
            </Button>
          ) : null}
          <Button size="sm" onClick={retest} loading={testing} aria-label="Test Gemini">
            Test
          </Button>
        </>
      )}
    </SettingsRow>
  )
}
