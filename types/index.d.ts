// The `$.state` contract of the aico mods (`aico-mods` v1). Every value is kept
// under shape tag `v1`; change the tag when a value's fields change.
export type AskWarn = 'ask' | 'warn'
export type Tier = 'low' | 'medium' | 'high' | 'unknown'

export type ModsSettings = {
  savvy: { enabled: boolean; pane: 'auto' | 'command' }
  cache_tax: { enabled: boolean; pane: 'auto' | 'command' }
  reflect: { enabled: boolean; step_check: boolean; retrospective: boolean; mode: 'deterministic' | 'model' }
  blast_radius: { enabled: boolean; core: AskWarn; contract: AskWarn; security: AskWarn }
}

/** `settings.mjs get`, mods block and Role names. `known: false` means the script failed and the defaults stand. */
export type SettingsState = { known: boolean; mods: ModsSettings; roles: Record<string, string> }

export type RunStep = {
  step: string
  role: string
  status: 'done' | 'blocked' | 'needs-ceo' | 'handover' | 'unknown'
  round: number | 'unknown'
  file: string
  mtime: string
}

export type RunView = {
  v: 1
  slug: string
  state: 'running' | 'ended' | 'stale' | 'none'
  started: string | null
  ended: string | null
  outcome: 'ship' | 'abort' | null
  wave: number | null
  gates: { gate: 'brief' | 'plan' | 'ship'; result: 'passed' | 'changed' | 'stopped'; at: string }[]
  round: number | 'unknown'
  tier: Tier
  steps: RunStep[]
  warnings: string[]
}

/** `run-state.mjs active --json`. `known: false` means the script failed (fields show `unknown`). */
export type RunState = { known: boolean; slug: string | null; view: RunView | null }

/** One running subagent, from the `agent.spawn` prompt lines and `$.agent.list()`. A missing line is `null`. */
export type AgentRow = {
  step: string | null
  role: string | null
  name: string | null
  baseCommit: string | null
  tier: 'low' | 'medium' | 'high' | null
  startedMs: number
  isRunning: boolean
}

/** The last `ledger.mjs report <run> --json --live` answer as the guard kept it (the Cache Tax Step narrows it). */
export type CostState = { known: boolean; report: unknown }

/** Time of the newest main-loop request and the lifetime of its cache entry, in milliseconds. */
export type CacheClockState = { lastRequestMs: number | null; lifetimeMs: number | null; source: 'usage' | 'measured' | null }

export type ReflectState = { pending: { role: string; text: string }[] }

export type BlastState = { warn: { category: 'core' | 'contract' | 'security'; count: number; untilMs: number } | null }

export type CtxState = { lead: number | null; agents: { id: string; ctx: number | null }[] }

declare module 'claude-code' {
  interface PluginState {
    aico: {
      settings: Shaped<SettingsState>
      run: Shaped<RunState>
      agents: StateFamily<Shaped<AgentRow>>
      cost: Shaped<CostState>
      cacheClock: Shaped<CacheClockState>
      reflect: Shaped<ReflectState>
      blast: Shaped<BlastState>
      ctx: Shaped<CtxState>
    }
  }
}
