import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { buildReason, agentLabel, decide, hitsFromDepth, listing, parseSpawnLines, reviewArgs, unknownHits } from './lib/blast.mjs'
import { guardReviewDepth, guardRunActive } from './lib/guard.mjs'
import { commitIntent } from './lib/git-commit.mjs'
import { TIMEOUT_MS, runScript } from './shared/run-script'
import { readSettings } from './shared/settings'
import { setStatusPart } from './shared/status'
import type { BlastState } from '../types'

const SHOW_MS = 60000
const MAX_LABELS = 200
const REVIEWER = /^(aico:)?code-reviewer$/

// The validator reads state keys from atoms declared in the file that uses them.
const blast = atom({ plugin: 'aico', key: 'blast' } as const, { warn: null } as BlastState, { shape: 'v1' })

// Step and role of the subagents this session dispatched, by agent id, for the `From subagent` prefix.
const labels = new Map<string, string>()
let shownToken = 0

type Hits = ReturnType<typeof unknownHits>
type Gate = { enabled: boolean; core: string; contract: string; security: string }

function shellOf(tool: string): 'bash' | 'powershell' | null {
  if (tool === 'Bash') return 'bash'
  if (tool === 'PowerShell') return 'powershell'
  return null
}

function commandOf(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : null
}

function idLabel(agentId: string): string {
  const known = labels.get(agentId)
  if (known !== undefined) return known
  return String(agentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'unknown'
}

function remember(agentId: string, label: string): void {
  if (labels.size >= MAX_LABELS) {
    const oldest = labels.keys().next()
    if (!oldest.done) labels.delete(oldest.value)
  }
  labels.set(agentId, label)
}

// The tier of the active run, only to pass `--risk`; the answer decides nothing here.
async function runTier($: EngineInterface): Promise<'low' | 'medium' | 'high' | undefined> {
  const r = await runScript($, 'run-state', ['active', '--json'], TIMEOUT_MS.runState, guardRunActive)
  if (!r.ok) return undefined
  const view = (r.value as { view: { state: string; tier: string } | null }).view
  if (view === null || view.state !== 'running') return undefined
  return view.tier === 'low' || view.tier === 'medium' || view.tier === 'high' ? view.tier : undefined
}

async function readDepth($: EngineInterface, spec: Parameters<typeof reviewArgs>[0], timeoutMs: number): Promise<Hits | null> {
  const args = reviewArgs(spec)
  if (args === null) return null
  const r = await runScript($, 'review-depth', args, timeoutMs, guardReviewDepth)
  return r.ok ? (hitsFromDepth(r.value) as Hits) : null
}

// Shows a status part and, for a warning, the state record; clears both after a minute unless a newer one replaced them.
async function show($: EngineInterface, part: string, warn: BlastState['warn']): Promise<void> {
  const token = ++shownToken
  const untilMs = (await $.clock.now()) + SHOW_MS
  await update($, blast, () => ({ warn: warn === null ? null : { ...warn, untilMs } }))
  void setStatusPart($, 'blast', part)
  void $.clock
    .sleep(SHOW_MS)
    .then(async () => {
      if (token !== shownToken) return
      await update($, blast, () => ({ warn: null }))
      void setStatusPart($, 'blast', undefined)
    })
    .catch(() => undefined)
}

async function gate($: EngineInterface, e: { agentId?: string; approver?: string }, intent: ReturnType<typeof commitIntent>, settings: Gate, verdict: unknown) {
  const risk = await runTier($)
  const hits = (await readDepth($, { source: intent.scope === 'staged' ? 'staged' : 'worktree', risk, repo: intent.repo }, TIMEOUT_MS.depthGate)) ?? unknownHits()
  const answer = decide(hits, settings, e.approver)
  if (answer.action === 'none') return verdict
  $.ui.log(listing(hits))
  if (answer.action === 'ask' || answer.action === 'deny') {
    const label = e.agentId === undefined ? null : idLabel(e.agentId)
    return { decision: answer.action, reason: buildReason(hits, answer.action, label) }
  }
  const warn = answer.warn
  if (warn !== null) {
    $.ui.toast(`Blast Radius: ${warn.category} ${warn.count} (warn); commit goes on`)
    await show($, `blast warn ${warn.category} ${warn.count}`, { ...warn, untilMs: 0 })
  }
  return verdict
}

// The commit gate (`tool.check` on both shell tools) and the pre-review listing (`agent.spawn`).
export function registerBlastRadius(on: On): void {
  on('tool.check', async ($, e, next) => {
    const shell = shellOf(e.tool)
    const command = commandOf(e.input)
    if (shell === null || command === null) return next(e)
    const settings = (await readSettings($)).mods.blast_radius
    if (settings.enabled === false) return next(e)
    const intent = commitIntent(command, shell)
    if (!intent.isCommit) return next(e)
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    return gate($, e, intent, settings, verdict) as Promise<typeof verdict>
  }).catch(($, e, next) => {
    const shell = shellOf(e.tool)
    const command = commandOf(e.input)
    if (shell !== null && command !== null && commitIntent(command, shell).isCommit) {
      return { decision: 'deny', reason: 'Blast Radius failed; commit refused' }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const settings = (await readSettings($)).mods.blast_radius
    if (settings.enabled === false) return next(e)
    const lines = parseSpawnLines(e.prompt)
    const label = agentLabel(lines.step, lines.role)
    if (REVIEWER.test(e.subagentType) && lines.base !== null) {
      const hits = await readDepth($, { source: 'base', base: lines.base, risk: lines.tier ?? undefined }, TIMEOUT_MS.depthPre)
      if (hits !== null) {
        $.ui.log(listing(hits))
        $.ui.toast(`Blast Radius: review depth ${hits.depth}, tier ${hits.tier}, ${hits.files} files`)
        await show($, `blast ${hits.tier} ${hits.depth}`, null)
      }
    }
    const started = await next(e)
    if (label !== null && typeof started.agentId === 'string') remember(started.agentId, label)
    return started
  }).catch(($, e, next) => next(e))
}
