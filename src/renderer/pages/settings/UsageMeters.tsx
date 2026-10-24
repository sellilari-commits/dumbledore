/**
 * Today's AI usage per model against the free limits: calls, tokens, and thin meters for
 * requests/day and tokens/day (orange near the limit, red at it). Apple's model has no limit.
 */
import { EmptyState, ErrorState, LoadingState, ProgressBar } from '@renderer/design-system'
import { formatTokens } from '@renderer/lib/format'
import { useUsage } from '@renderer/lib/queries'
import type { UsageSummary } from '@shared/state'

const PROVIDER_NAME: Record<string, string> = {
  gemini: 'Gemini',
  apple: 'Apple',
  groq: 'Groq',
  ovh: 'OVHcloud',
  mistral: 'Mistral',
}

function meterColor(share: number): 'green' | 'orange' | 'red' {
  if (share >= 0.95) return 'red'
  if (share >= 0.8) return 'orange'
  return 'green'
}

function Meter({
  label,
  used,
  limit,
  format,
}: {
  label: string
  used: number
  limit: number | null
  format: (n: number) => string
}) {
  if (limit === null)
    return (
      <div>
        <div className="dd-usage__bar-label">
          <span>{label}</span>
          <span>{format(used)} · no daily limit</span>
        </div>
      </div>
    )
  const share = limit > 0 ? used / limit : 0
  return (
    <div>
      <div className="dd-usage__bar-label">
        <span>{label}</span>
        <span>
          {format(used)} of {format(limit)}
        </span>
      </div>
      <ProgressBar value={share} color={meterColor(share)} label={`${label} used today`} />
    </div>
  )
}

function UsageRow({
  row,
  limits,
}: {
  row: UsageSummary['rows'][number]
  limits: UsageSummary['limits']
}) {
  const limit = limits.find((l) => l.provider === row.provider && l.model === row.model)
  const calls = (n: number) => n.toLocaleString('en-US')
  return (
    <div className="dd-usage__row">
      <div className="dd-usage__head">
        <span className="dd-usage__model">
          {row.provider === 'apple' ? 'On-device model' : row.model}
          <span className="dd-usage__provider">{PROVIDER_NAME[row.provider] ?? row.provider}</span>
        </span>
        <span className="dd-usage__meta">
          {calls(row.calls)} calls
          {row.failures ? ` · ${row.failures} failed` : ''}
        </span>
      </div>
      <div className="dd-usage__bars">
        <Meter
          label="Requests"
          used={row.calls}
          limit={limit?.requestsPerDay ?? null}
          format={calls}
        />
        <Meter
          label="Tokens"
          used={row.tokensIn + row.tokensOut}
          limit={limit?.tokensPerDay ?? null}
          format={formatTokens}
        />
      </div>
    </div>
  )
}

export function UsageMeters() {
  const usage = useUsage()
  if (usage.isLoading) return <LoadingState caption="Counting today’s AI calls…" lines={3} />
  if (usage.isError)
    return (
      <ErrorState
        compact
        title="Couldn’t load today’s usage"
        error={usage.error}
        onRetry={() => usage.refetch()}
      />
    )
  const rows = usage.data?.rows ?? []
  if (rows.length === 0)
    return (
      <EmptyState compact icon="📊" title="No AI calls yet today">
        Usage shows up here as Dumbledore reads, plans and writes prompts.
      </EmptyState>
    )
  return (
    <div>
      {rows.map((r) => (
        <UsageRow key={`${r.provider}:${r.model}`} row={r} limits={usage.data?.limits ?? []} />
      ))}
    </div>
  )
}
