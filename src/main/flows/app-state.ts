/**
 * AppState (capture, permissions, helper, AI readiness, focus, "right now", AI chat, the
 * student's usual AI) and a small
 * permissions cache that polls the helper so onboarding's ✓ flips by itself once granted.
 */
import type { Cancel, Clock } from '@engine/clock'
import type { HelperClient, PerceptionService, SettingsRepo } from '@engine/contracts'
import type { AppState, PermissionsStatus } from '@shared/state'
import type { ProviderService } from '../services'

export const PERMISSIONS_POLL_MS = 5000

export class PermissionsCache {
  private value: PermissionsStatus = { accessibility: false, screenRecording: false }
  private stopPoll: Cancel | null = null

  constructor(
    private readonly helper: HelperClient,
    private readonly clock: Clock,
    private readonly onChange: () => void,
  ) {}

  get current(): PermissionsStatus {
    return this.value
  }

  start(): void {
    void this.refresh()
    this.stopPoll ??= this.clock.setInterval(() => void this.refresh(), PERMISSIONS_POLL_MS)
  }

  stop(): void {
    this.stopPoll?.()
    this.stopPoll = null
  }

  async refresh(): Promise<PermissionsStatus> {
    if (this.helper.status !== 'connected') return this.value
    try {
      const next = await this.helper.call('permissions.status', {}, { timeoutMs: 1000 })
      if (
        next.accessibility !== this.value.accessibility ||
        next.screenRecording !== this.value.screenRecording
      ) {
        this.value = { accessibility: next.accessibility, screenRecording: next.screenRecording }
        this.onChange()
      }
    } catch {
      // keep the last known value
    }
    return this.value
  }
}

export interface AppStateDeps {
  settings: Pick<SettingsRepo, 'get'>
  perception: Pick<PerceptionService, 'isActive' | 'now' | 'aiChat'>
  helper: Pick<HelperClient, 'status'>
  providers: Pick<ProviderService, 'status'>
  permissions: Pick<PermissionsCache, 'current'>
  /** The AI the student usually studies with (from captures), for when no chat is open. */
  usualAssistant?: () => { key: string; name: string } | null
  version: string
}

/** The open AI chat, else the usual one: one name for every label and link. */
function assistantOf(
  chat: ReturnType<PerceptionService['aiChat']>,
  usual: AppStateDeps['usualAssistant'],
): AppState['assistant'] {
  if (chat) return { key: chat.key, name: chat.assistant, open: true }
  const u = usual?.()
  return u ? { key: u.key, name: u.name, open: false } : null
}

export function buildAppState(d: AppStateDeps): AppState {
  const settings = d.settings.get()
  const chat = d.perception.aiChat()
  return {
    capture: { enabled: settings.captureEnabled, active: d.perception.isActive() },
    permissions: d.permissions.current,
    helper: d.helper.status,
    ai: d.providers.status(),
    focusSubjectId: settings.focusSubjectId,
    now: d.perception.now(),
    aiChat: chat ? { provider: chat.assistant } : null,
    assistant: assistantOf(chat, d.usualAssistant),
    onboardingDone: settings.onboardingDone,
    version: d.version,
  }
}
