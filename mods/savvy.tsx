import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import { guardRunActive } from './lib/guard.mjs'
import { fit, fmtDuration, fmtMinutes, UNKNOWN } from './lib/format.mjs'
import { TIMEOUT_MS, runScript } from './shared/run-script'
import { readSettings } from './shared/settings'
import { setStatusPart } from './shared/status'
import { isViewSurface } from './shared/surface'
import type { AgentRow, RunState, RunView, SettingsState } from '../types'

const PANE = 'aico-run'
const COMMAND = 'aico-run'
const TICK_MS = 2000
const POLL_MS = 10000
const MAX_AGENTS = 40
const SHOWN_AGENTS = 10
const DEFAULT_WIDTH = 39
const SLUG_CELLS = 24
const PROMPT_HEAD = 65536

// The validator reads a state key from an atom declared in the file that uses it.
const run = atom({ plugin: 'aico', key: 'run' } as const, { known: true, slug: null, view: null } as RunState, { shape: 'v1' })
const EMPTY_AGENT: AgentRow = { step: null, role: null, name: null, baseCommit: null, tier: null, startedMs: 0, isRunning: false }
const agents = atom({ plugin: 'aico', key: 'agents' } as const, EMPTY_AGENT, { shape: 'v1' })

// Timers and bookkeeping only; no view draws from these.
let timer: { cancel: () => unknown } | undefined
let isForced = false
let lastSignature = ''
let lastPollMs = 0

const OUTPUT_LINE = /^Output: \.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/(\d{2})-([a-z][a-z0-9-]{0,40})\.md$/m
const NAME_LINE = /^Name: ([^\r\n]{1,40})$/m
const BASE_LINE = /^Base commit: ([0-9a-f]{7,40})$/m
const TIER_LINE = /^Risk tier: (low|medium|high)$/m
const ROLE = /^[a-z][a-z0-9-]{0,40}$/

type Entry = { type: string; row: AgentRow }
type AgentLine = { head: string; tail: string }
type Model = {
  slug: string
  state: string
  wave: string
  step: string
  round: string
  gates: string
  elapsed: string
  agents: AgentLine[]
  status: string | undefined
}

function shown(value: string | null | undefined, roles: Record<string, string>, role: string | null): string {
  if (value !== null && value !== undefined) return value
  return role !== null && Object.hasOwn(roles, role) ? roles[role] : UNKNOWN
}

function roleOf(type: string, row: AgentRow): string | null {
  if (row.role !== null) return row.role
  const bare = type.startsWith('aico:') ? type.slice(5) : type
  return ROLE.test(bare) ? bare : null
}

function whoLabel(step: string | null, role: string | null, name: string): string {
  return `${step ?? UNKNOWN} ${role ?? UNKNOWN} (${name})`
}

// The model of the run view: strings only, every unknown field a `?`.
function buildModel(state: RunState, entries: Entry[], roles: Record<string, string>, nowMs: number): Model | undefined {
  const view: RunView | null = state.view
  if (state.slug === null) {
    if (state.known) return undefined
    return { slug: UNKNOWN, state: UNKNOWN, wave: UNKNOWN, step: UNKNOWN, round: UNKNOWN, gates: UNKNOWN, elapsed: UNKNOWN, agents: [], status: undefined }
  }
  const slug = state.slug
  if (view === null) {
    return { slug, state: UNKNOWN, wave: UNKNOWN, step: UNKNOWN, round: UNKNOWN, gates: UNKNOWN, elapsed: UNKNOWN, agents: [], status: `run ${fit(slug, SLUG_CELLS)} w${UNKNOWN} S${UNKNOWN} r${UNKNOWN} ${UNKNOWN}` }
  }
  const wave = typeof view.wave === 'number' ? String(view.wave) : UNKNOWN
  const round = typeof view.round === 'number' ? String(view.round) : UNKNOWN
  const passed: string[] = []
  for (const g of view.gates) if (g.result === 'passed' && !passed.includes(g.gate)) passed.push(g.gate)
  const gates = passed.length === 0 ? 'none' : passed.join(', ')
  const startedMs = view.started === null ? Number.NaN : Date.parse(view.started)
  const endedMs = view.ended === null ? Number.NaN : Date.parse(view.ended)
  const isEnded = view.state === 'ended'
  const elapsed = fmtDuration((isEnded && !Number.isNaN(endedMs) ? endedMs : nowMs) - startedMs)

  const lines: AgentLine[] = []
  let current: { step: string; role: string | null; name: string } | undefined
  for (const { type, row } of entries) {
    const role = roleOf(type, row)
    const name = shown(row.name, roles, role)
    const startedAt = row.startedMs > 0 ? fmtDuration(nowMs - row.startedMs) : UNKNOWN
    lines.push({ head: whoLabel(row.step, role, name), tail: startedAt })
    if (row.step !== null && (current === undefined || row.step > current.step)) current = { step: row.step, role, name }
  }
  if (current === undefined) {
    const files = [...view.steps].sort((a, b) => (a.mtime === b.mtime ? (a.step < b.step ? 1 : -1) : a.mtime < b.mtime ? 1 : -1))
    if (files.length > 0) current = { step: files[0].step, role: files[0].role, name: shown(null, roles, files[0].role) }
  }
  const step = current === undefined ? UNKNOWN : whoLabel(current.step, current.role, current.name)
  const stepNumber = current === undefined ? UNKNOWN : current.step
  const label = isEnded ? `ended (${view.outcome ?? UNKNOWN})` : view.state
  const minutes = fmtMinutes((isEnded && !Number.isNaN(endedMs) ? endedMs : nowMs) - startedMs)
  const shortSlug = fit(slug, SLUG_CELLS)
  const status = isEnded
    ? `run ${shortSlug} ended ${view.outcome ?? UNKNOWN} ${minutes}`
    : view.state === 'running'
      ? `run ${shortSlug} w${wave} S${stepNumber} r${round} ${minutes}`
      : `run ${shortSlug} ${view.state}`
  return { slug, state: label, wave, step, round, gates, elapsed, agents: lines, status }
}

function labelled(label: string, value: string): string {
  return `${label.padEnd(8)} ${value}`
}

function renderRows(model: Model, width: number): string[] {
  const rows: string[] = [
    labelled('Run', model.slug),
    labelled('State', model.state),
    labelled('Wave', model.wave),
    labelled('Step', model.step),
    labelled('Gates', model.gates),
    labelled('Fix round', model.round),
    labelled('Elapsed', model.elapsed),
  ]
  if (model.agents.length === 0) {
    rows.push('No subagent running.')
  } else {
    rows.push(`Running subagents (${model.agents.length})`)
    for (const one of model.agents.slice(0, SHOWN_AGENTS)) {
      const room = Math.max(1, width - one.tail.length - 1)
      rows.push(`${fit(one.head, room)} ${one.tail}`)
    }
    if (model.agents.length > SHOWN_AGENTS) rows.push(`+${model.agents.length - SHOWN_AGENTS} more`)
  }
  return rows.map(row => fit(row, width))
}

function paneWidth(e: RenderInput): number {
  const columns = (e.props as { bodyColumns?: unknown }).bodyColumns
  return typeof columns === 'number' && Number.isInteger(columns) && columns >= 10 && columns <= 400 ? columns : DEFAULT_WIDTH
}

// The run view as `show` prints it, kept through the same allow-list as `active`.
function guardShow(value: unknown): RunView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const slug = (value as { slug?: unknown }).slug
  const checked = guardRunActive({ slug, view: value }) as { view: RunView | null } | undefined
  return checked === undefined || checked.view === null ? undefined : checked.view
}

async function gather($: EngineInterface): Promise<{ settings: SettingsState; state: RunState; entries: Entry[]; nowMs: number }> {
  const settings = await readSettings($)
  const state = await read($, run)
  const nowMs = await $.clock.now()
  let list: { id: string; type: string; status: string }[] = []
  try {
    list = (await $.agent.list()) as never
  } catch {
    list = []
  }
  const entries: Entry[] = []
  for (const info of list) {
    if (entries.length >= MAX_AGENTS) break
    if (info.status !== 'running') continue
    const row = await read($, memberOf(agents, { requestId: info.id }))
    entries.push({ type: String(info.type), row })
  }
  return { settings, state, entries, nowMs }
}

async function drawPane($: EngineInterface, e: RenderInput) {
  const { settings, state, entries, nowMs } = await gather($)
  if (!settings.mods.savvy.enabled) return undefined
  const model = buildModel(state, entries, settings.roles, nowMs)
  if (model === undefined) return undefined
  const { Box, Text } = $.ui.resolve(e)
  const rows = renderRows(model, paneWidth(e))
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text>{row}</Text>
      ))}
    </Box>
  )
}

async function publish($: EngineInterface): Promise<void> {
  const { settings, state, entries, nowMs } = await gather($)
  const model = buildModel(state, entries, settings.roles, nowMs)
  await setStatusPart($, 'savvy', model?.status)
  if (model !== undefined) await $.ui.invalidate('ui.render')
}

async function stamp($: EngineInterface, path: string): Promise<string> {
  try {
    const s = await $.fs.stat(path)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return '-'
  }
}

async function signature($: EngineInterface, root: string, slug: string): Promise<string> {
  const dir = `${root}/.company/work/${slug}`
  return `${await stamp($, dir)}|${await stamp($, `${dir}/run-state.jsonl`)}`
}

async function openPane($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: 'Savvy' })
  } catch {
    // The status line carries the summary when no pane opens.
  }
}

// Reads the active run; the last view of a run that has just ended is read once with `show`.
async function refreshRun($: EngineInterface, previous: RunState, pane: 'auto' | 'command', root: string): Promise<void> {
  const active = await runScript($, 'run-state', ['active', '--json'], TIMEOUT_MS.runState, guardRunActive)
  let next: RunState
  if (!active.ok) {
    next = { known: false, slug: previous.slug, view: null }
  } else {
    const found = active.value as { slug: string | null; view: RunView | null }
    if (found.slug !== null && found.view !== null) {
      next = { known: true, slug: found.slug, view: found.view }
    } else if (previous.slug !== null && previous.view?.state !== 'ended') {
      const shownEnd = await runScript($, 'run-state', ['show', previous.slug, '--json'], TIMEOUT_MS.runState, guardShow)
      next = shownEnd.ok ? { known: true, slug: previous.slug, view: shownEnd.value } : { known: false, slug: previous.slug, view: null }
    } else {
      next = previous.slug !== null ? previous : { known: true, slug: null, view: null }
    }
  }
  await update($, run, () => next)
  if (next.slug !== null) lastSignature = await signature($, root, next.slug)
  const wasRunning = previous.view?.state === 'running' && previous.slug === next.slug
  if (pane === 'auto' && next.view?.state === 'running' && !wasRunning) await openPane($)
}

async function tickOnce($: EngineInterface): Promise<void> {
  const settings = await readSettings($)
  if (!settings.mods.savvy.enabled) {
    stopTimer()
    await setStatusPart($, 'savvy', undefined)
    return
  }
  const nowMs = await $.clock.now()
  const root = await $.session.root()
  const current = await read($, run)
  const isFollowing = current.slug !== null && (current.view === null || current.view.state === 'running')
  let isDue = isForced
  isForced = false
  if (isFollowing && current.slug !== null) {
    const sig = await signature($, root, current.slug)
    if (sig !== lastSignature) isDue = true
  }
  if (nowMs - lastPollMs >= POLL_MS && (!isFollowing || !current.known)) {
    lastPollMs = nowMs
    if (isFollowing || (await $.fs.exists(`${root}/.company/work`))) isDue = true
  }
  if (isDue) await refreshRun($, current, settings.mods.savvy.pane, root)
  await publish($)
}

async function tick($: EngineInterface): Promise<void> {
  try {
    await tickOnce($)
  } catch {
    // The next tick tries again; a view never throws.
  }
}

function stopTimer(): void {
  if (timer !== undefined) void timer.cancel()
  timer = undefined
}

async function ensureTimer($: EngineInterface): Promise<void> {
  if (timer !== undefined) return
  const settings = await readSettings($)
  if (!settings.mods.savvy.enabled) return
  timer = $.clock.every(TICK_MS, () => tick($))
}

// Settings arrive from a script after start-up: wait a little for them, then run on the defaults.
async function begin($: EngineInterface): Promise<void> {
  try {
    for (let i = 0; i < 10; i++) {
      if ((await readSettings($)).known) break
      await $.clock.sleep(300)
    }
    await ensureTimer($)
    await tick($)
  } catch {
    // Savvy stays quiet when it cannot start.
  }
}

async function afterTurnStart($: EngineInterface): Promise<void> {
  try {
    await $.clock.sleep(1500)
    await ensureTimer($)
  } catch {
    // The settings are read again at the next turn.
  }
}

function parsePrompt(prompt: unknown): Pick<AgentRow, 'step' | 'role' | 'name' | 'baseCommit' | 'tier'> {
  const head = typeof prompt === 'string' ? prompt.slice(0, PROMPT_HEAD).replace(/\r\n?/g, '\n') : ''
  const output = OUTPUT_LINE.exec(head)
  const name = NAME_LINE.exec(head)
  const base = BASE_LINE.exec(head)
  const tier = TIER_LINE.exec(head)
  return {
    step: output === null ? null : output[2],
    role: output === null ? null : output[3],
    name: name === null ? null : fit(name[1], 40),
    baseCommit: base === null ? null : base[1],
    tier: tier === null ? null : (tier[1] as 'low' | 'medium' | 'high'),
  }
}

async function noteSpawn($: EngineInterface, prompt: unknown, agentId: unknown): Promise<void> {
  try {
    if (typeof agentId !== 'string') return
    const settings = await readSettings($)
    if (!settings.mods.savvy.enabled) return
    const row: AgentRow = { ...parsePrompt(prompt), startedMs: await $.clock.now(), isRunning: true }
    await update($, memberOf(agents, { requestId: agentId }), () => row)
    isForced = true
    await $.ui.invalidate('ui.render')
  } catch {
    // A spawn is never held up by Savvy.
  }
}

function markForced(): void {
  isForced = true
}

async function runCommand($: EngineInterface): Promise<{ text: string }> {
  const { settings, state } = await gather($)
  if (!settings.mods.savvy.enabled) return { text: 'savvy is off; switch it on in /aico:settings' }
  if (state.known && state.slug === null) return { text: 'No aico run is active.' }
  await openPane($)
  return { text: state.known ? 'Savvy pane opened.' : 'Savvy pane opened; the run state is unknown.' }
}

export function registerSavvy(on: On): void {
  // The shell and Blast Radius own the unmatched `session.start` and `agent.spawn` hooks; a match-all pattern keeps Savvy's own apart from them.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Show the progress of the active aico run' })
    } catch {
      // The command is a convenience; the view works without it.
    }
    stopTimer()
    lastSignature = ''
    lastPollMs = 0
    void begin($)
    return next(e)
  })

  // A switched-on mod starts its timer by the next prompt; the shell's `turn.start` already refreshes the settings.
  on('prompt.submit', async ($, e, next) => {
    void afterTurnStart($)
    return next(e)
  })

  on('turn.complete', async (_, e, next) => {
    if (e.agentId !== undefined) markForced()
    return next(e)
  })

  on('agent.spawn', { subagentType: /^/ }, async ($, e, next) => {
    const out = await next(e)
    await noteSpawn($, e.prompt, out.agentId)
    return out
  })

  on('command.run', { command: COMMAND }, async $ => runCommand($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!isViewSurface(e.surface)) return next(e)
    const tree = await drawPane($, e)
    return tree === undefined ? next(e) : tree
  })
}
