/** SQLite ProfileRepo (single row), SettingsRepo (key → JSON value) and UsageRepo (LLM call log). */
import { DEFAULT_SETTINGS, type Profile, type Settings } from '@shared/domain'
import type { UsageSummary } from '@shared/state'
import type { LlmCallRecord, ProfileRepo, SettingsRepo, UsageRepo } from '../../contracts'
import { codec, insertSql, type Row } from '../codec'
import type { StoreCtx } from '../context'

export const EMPTY_HABITS: Profile['habits'] = {
  promptsSeen: 0,
  withContext: 0,
  withStructure: 0,
  askedToBeQuizzed: 0,
  askedForExamples: 0,
}

const profileCodec = codec<Profile>({
  aboutMe: 'text',
  level: 'text',
  promptLanguage: 'text',
  habits: 'json',
  summary: 'text',
  updatedAt: 'text',
})

const callCodec = codec<LlmCallRecord>({
  at: 'text',
  provider: 'text',
  model: 'text',
  tier: 'text',
  task: 'text',
  tokensIn: 'num',
  tokensOut: 'num',
  latencyMs: 'num',
  ok: 'bool',
  error: 'text',
})

const PROFILE_UPSERT = `${insertSql('profile', ['id', ...profileCodec.columns])}
  ON CONFLICT (id) DO UPDATE SET ${profileCodec.columns.map((c) => `${c} = excluded.${c}`).join(', ')}`

export function createProfileRepo(ctx: StoreCtx): ProfileRepo {
  const { stmt } = ctx
  const defaults = (): Profile => ({
    aboutMe: '',
    level: null,
    promptLanguage: 'auto',
    habits: { ...EMPTY_HABITS },
    summary: '',
    updatedAt: ctx.now(),
  })
  stmt(`${insertSql('profile', ['id', ...profileCodec.columns])} ON CONFLICT (id) DO NOTHING`).run({
    id: 1,
    ...profileCodec.params(defaults()),
  })
  const get = (): Profile => {
    const r = stmt('SELECT * FROM profile WHERE id = 1').get() as Row | undefined
    return r ? profileCodec.decode(r) : defaults()
  }
  return {
    get,
    update(patch) {
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      const next: Profile = { ...get(), ...structuredClone(defined), updatedAt: ctx.now() }
      stmt(PROFILE_UPSERT).run({ id: 1, ...profileCodec.params(next) })
      return get()
    },
  }
}

export function createSettingsRepo(ctx: StoreCtx): SettingsRepo {
  const { stmt } = ctx
  const known = new Set(Object.keys(DEFAULT_SETTINGS))
  const get = (): Settings => {
    const settings = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>
    for (const r of stmt('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]) {
      if (known.has(r.key)) settings[r.key] = JSON.parse(r.value)
    }
    return settings as Settings
  }
  return {
    get,
    update(patch) {
      const put = stmt(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      ctx.db.transaction(() => {
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined && known.has(key)) put.run(key, JSON.stringify(value))
        }
      })()
      return get()
    },
  }
}

export function createUsageRepo(ctx: StoreCtx): UsageRepo {
  const { stmt } = ctx
  return {
    record: (call) =>
      void stmt(insertSql('llm_calls', callCodec.columns)).run(callCodec.params(call)),
    rowsSince(sinceIso) {
      const rows = stmt(
        `SELECT provider, model, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
           SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, MIN(seq) AS first
         FROM llm_calls WHERE at >= ? GROUP BY provider, model ORDER BY first`,
      ).all(sinceIso) as Row[]
      return rows.map((r): UsageSummary['rows'][number] => ({
        provider: String(r.provider),
        model: String(r.model),
        calls: Number(r.calls),
        failures: Number(r.failures),
        tokensIn: Number(r.tokens_in),
        tokensOut: Number(r.tokens_out),
      }))
    },
    countSince(provider, model, sinceIso) {
      const r = stmt(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens
         FROM llm_calls WHERE provider = ? AND model = ? AND at >= ?`,
      ).get(provider, model, sinceIso) as { requests: number; tokens: number }
      return { requests: Number(r.requests), tokens: Number(r.tokens) }
    },
  }
}
