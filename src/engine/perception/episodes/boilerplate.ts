/**
 * Boilerplate stripper (docs/PLAN.md §6.4): lines seen in ≥ 80% of an app's recent frames are
 * menus, nav bars and other chrome. Shares are counted per page (distinct episode key) across
 * the recent frames, so one long read can never mark its own text as chrome; at least three
 * different pages are needed before anything is stripped. Scopes: the app, and app + site.
 */

export interface BoilerplateOptions {
  maxFrames: number
  minPages: number
  share: number
}

const DEFAULTS: BoilerplateOptions = { maxFrames: 40, minPages: 3, share: 0.8 }
const MAX_SCOPES = 64

interface FrameRecord {
  page: string
  keys: ReadonlySet<string>
}

interface ScopeState {
  frames: FrameRecord[]
  /** Cache: line key → number of distinct pages containing it; null when stale. */
  counts: Map<string, number> | null
  pages: number
}

export class BoilerplateStripper {
  private readonly scopes = new Map<string, ScopeState>()
  private readonly opts: BoilerplateOptions

  constructor(opts: Partial<BoilerplateOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  static scopesFor(bundleId: string, host: string | null): string[] {
    return host ? [`app:${bundleId}`, `site:${bundleId}|${host}`] : [`app:${bundleId}`]
  }

  /** Records one changed frame of `page` under each scope. */
  observe(scopes: readonly string[], page: string, keys: ReadonlySet<string>): void {
    if (keys.size === 0) return
    for (const scope of scopes) {
      let state = this.scopes.get(scope)
      if (!state) {
        state = { frames: [], counts: null, pages: 0 }
        this.scopes.set(scope, state)
        if (this.scopes.size > MAX_SCOPES) {
          const oldest = this.scopes.keys().next().value
          if (oldest !== undefined && oldest !== scope) this.scopes.delete(oldest)
        }
      }
      state.frames.push({ page, keys })
      if (state.frames.length > this.opts.maxFrames) state.frames.shift()
      state.counts = null
    }
  }

  isBoilerplate(scopes: readonly string[], key: string): boolean {
    for (const scope of scopes) {
      const state = this.scopes.get(scope)
      if (!state) continue
      const counts = this.countsOf(state)
      if (state.pages < this.opts.minPages) continue
      if ((counts.get(key) ?? 0) / state.pages >= this.opts.share) return true
    }
    return false
  }

  private countsOf(state: ScopeState): Map<string, number> {
    if (state.counts) return state.counts
    const perPage = new Map<string, Set<string>>()
    for (const f of state.frames) {
      let set = perPage.get(f.page)
      if (!set) {
        set = new Set()
        perPage.set(f.page, set)
      }
      for (const k of f.keys) set.add(k)
    }
    const counts = new Map<string, number>()
    for (const set of perPage.values()) {
      for (const k of set) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    state.counts = counts
    state.pages = perPage.size
    return counts
  }
}
