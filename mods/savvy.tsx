import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import { ctxCell, idChunks, leadRow, pairUp, worstNote } from './lib/ctx-row.mjs'
import { guardAgentCtx, guardLeadCtx, guardRunActive, parseOutputText } from './lib/guard.mjs'
import { progressRows } from './lib/bars.mjs'
import { fit, fmtDuration, fmtMinutes, UNKNOWN } from './lib/format.mjs'
import { TIMEOUT_MS, runScript } from './shared/run-script'
import { readSettings } from './shared/settings'
import { setStatusPart } from './shared/status'
import { isViewSurface } from './shared/surface'
import type { AgentRow, CtxState, RunState, RunView, SettingsState } from '../types'

const PANE = 'aico-run'
const COMMAND = 'aico-run'
const TICK_MS = 2000
const POLL_MS = 10000
const MAX_AGENTS = 40
const SHOWN_AGENTS = 10
const DEFAULT_WIDTH = 39
const MIN_HEAD = 12
const PROMPT_HEAD = 65536

// The validator reads a state key from an atom declared in the file that uses it.
const run = atom({ plugin: 'aico', key: 'run' } as const, { known: true, slug: null, view: null } as RunState, { shape: 'v1' })
const EMPTY_AGENT: AgentRow = { step: null, role: null, name: null, baseCommit: null, tier: null, startedMs: 0, isRunning: false }
const agents = atom({ plugin: 'aico', key: 'agents' } as const, EMPTY_AGENT, { shape: 'v1' })

const EMPTY_CTX: CtxState = { lead: null, agents: [] }
const ctx = atom({ plugin: 'aico', key: 'ctx' } as const, EMPTY_CTX, { shape: 'v1' })

// Timers and bookkeeping only; no view draws from these.
let timer: { cancel: () => unknown } | undefined
let isForced = false
let lastSignature = ''
let lastPollMs = 0
let lastLeadKey = ''
let agentTimer: { cancel: () => unknown } | undefined
let isPolling = false

const BASE_LINE = /^Base commit: ([0-9a-f]{40}|[0-9a-f]{64})$/m
const TIER_LINE = /^Risk tier: (low|medium|high)$/m
const ROLE = /^[a-z][a-z0-9-]{0,40}$/

type Entry = { id: string; type: string; row: AgentRow }
type AgentLine = { head: string; units: string[] }
type Model = {
  slug: string
  state: string
  wave: string
  step: string
  round: string
  gates: string
  view: RunView | null
  elapsed: string
  agents: AgentLine[]
  lead: string | undefined
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

// Two letters for each leading word and three for the last: `backend-engineer` becomes `ba-eng`.
function shortRole(role: string | null): string {
  if (role === null) return ''
  const words = role.split('-')
  const last = words.length - 1
  return `${words.map((w, i) => w.slice(0, i === last ? 3 : 2)).join('-')} `
}

function whoLabel(step: string | null, role: string | null, name: string): string {
  return `${step ?? UNKNOWN} ${role ?? UNKNOWN} (${name})`
}

// The model of the run view: strings only, every unknown field a `?`.
function buildModel(state: RunState, entries: Entry[], roles: Record<string, string>, nowMs: number, counts: CtxState): Model | undefined {
  const view: RunView | null = state.view
  if (state.slug === null) {
    if (state.known) return undefined
    return { slug: UNKNOWN, state: UNKNOWN, wave: UNKNOWN, step: UNKNOWN, round: UNKNOWN, gates: UNKNOWN, view: null, elapsed: UNKNOWN, agents: [], lead: undefined, status: undefined }
  }
  const slug = state.slug
  const runMarks = state.view as { cap?: number | null; handover?: number | null } | null
  const cap = runMarks?.cap
  const handover = runMarks?.handover
  const lead = leadRow(counts.lead, cap, handover)
  if (view === null) {
    return { slug, state: UNKNOWN, wave: UNKNOWN, step: UNKNOWN, round: UNKNOWN, gates: UNKNOWN, view: null, elapsed: UNKNOWN, agents: [], lead, status: `W${UNKNOWN} S${UNKNOWN} ${UNKNOWN}` }
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
  const counted: (number | null)[] = [counts.lead]
  let current: { step: string; role: string | null; name: string } | undefined
  for (const { id, type, row } of entries) {
    const role = roleOf(type, row)
    const name = shown(row.name, roles, role)
    const startedAt = row.startedMs > 0 ? fmtDuration(nowMs - row.startedMs) : UNKNOWN
    const found = counts.agents.find(one => one.id === id)
    const ctxValue = found === undefined ? null : found.ctx
    counted.push(ctxValue)
    lines.push({ head: whoLabel(row.step, role, name), units: [startedAt, ...splitCell(ctxCell(ctxValue, cap, handover))] })
    if (row.step !== null && (current === undefined || Number(row.step) > Number(current.step))) current = { step: row.step, role, name }
  }
  if (current === undefined) {
    const files = [...view.steps].sort((a, b) => (a.mtime === b.mtime ? (Number(a.step) < Number(b.step) ? 1 : -1) : a.mtime < b.mtime ? 1 : -1))
    if (files.length > 0) current = { step: files[0].step, role: files[0].role, name: shown(null, roles, files[0].role) }
  }
  const step = current === undefined ? UNKNOWN : whoLabel(current.step, current.role, current.name)
  const stepNumber = current === undefined ? UNKNOWN : current.step
  const label = isEnded ? `ended (${view.outcome ?? UNKNOWN})` : view.state
  const minutes = fmtMinutes((isEnded && !Number.isNaN(endedMs) ? endedMs : nowMs) - startedMs)
  const status = isEnded
    ? `ended ${view.outcome ?? UNKNOWN} ${minutes}`
    : view.state === 'running'
      ? capped(worstNote(counted, cap, handover), `W${wave} S${stepNumber}`, `${shortRole(current?.role ?? null)}${minutes}`)
      : view.state
  return { slug, state: label, wave, step, round, gates, view, elapsed, agents: lines, lead, status }
}

// `ctx 90.0k near cap` as `ctx 90.0k` and `near cap`, so a narrow pane breaks between them and never inside the note.
function splitCell(cell: string): string[] {
  const at = cell.indexOf(' cap')
  return at < 0 ? [cell] : [cell.slice(0, at - 5), cell.slice(at - 4)]
}

// With a note the status part is `W1 S3 near cap`; without one it is the usual form, byte for byte.
function capped(note: string, front: string, rest: string): string {
  return note === '' ? `${front} ${rest}` : `${front} ${note}`
}

function agentRows(one: AgentLine, width: number): string[] {
  const tail = one.units.join(' ')
  const room = Math.max(1, width - tail.length - 1)
  if (room >= MIN_HEAD) return [`${fit(one.head, room)} ${tail}`]
  // Narrow: the label on its own row, then the units packed whole into rows that fit.
  return [fit(one.head, width), ...packUnits(one.units, width)]
}

function packUnits(units: string[], width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const unit of units) {
    if (line !== '' && line.length + 1 + unit.length <= width) line += ` ${unit}`
    else {
      if (line !== '') out.push(line)
      line = unit
    }
  }
  if (line !== '') out.push(line)
  return out
}

function labelled(label: string, value: string): string {
  return `${label.padEnd(8)} ${value}`
}

function renderRows(model: Model, width: number): string[] {
  const rows: string[] = [
    ...(model.lead === undefined ? [] : packUnits(['Lead', ...splitCell(model.lead.slice(5))], width)),
    labelled('Run', model.slug),
    labelled('State', model.state),
    labelled('Wave', model.wave),
    labelled('Step', model.step),
    labelled('Gates', model.gates),
    labelled('Fix round', model.round),
    labelled('Elapsed', model.elapsed),
    ...progressRows(model.view, width),
  ]
  if (model.agents.length === 0) {
    rows.push('No subagent running.')
  } else {
    rows.push(`Running subagents (${model.agents.length})`)
    for (const one of model.agents.slice(0, SHOWN_AGENTS)) {
      rows.push(...agentRows(one, width))
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

async function gather($: EngineInterface): Promise<{ settings: SettingsState; state: RunState; entries: Entry[]; nowMs: number; counts: CtxState }> {
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
    entries.push({ id: String(info.id), type: String(info.type), row })
  }
  return { settings, state, entries, nowMs, counts: await read($, ctx) }
}

async function drawPane($: EngineInterface, e: RenderInput) {
  const { settings, state, entries, nowMs, counts } = await gather($)
  if (!settings.mods.savvy.enabled) return undefined
  const model = buildModel(state, entries, settings.roles, nowMs, counts)
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
  const { settings, state, entries, nowMs, counts } = await gather($)
  const model = buildModel(state, entries, settings.roles, nowMs, counts)
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

// The Lead's context, read again only when `lead-context.json` changes.
async function refreshLead($: EngineInterface, root: string, slug: string): Promise<void> {
  const key = `${slug}|${await stamp($, `${root}/.company/work/${slug}/lead-context.json`)}`
  if (key === lastLeadKey) return
  const out = await runScript($, 'lead-handover', ['ctx', slug, '--json'], TIMEOUT_MS.leadCtx, guardLeadCtx)
  if (out.ok) lastLeadKey = key
  const lead = out.ok ? out.value.ctx : null
  await update($, ctx, prev => ({ ...prev, lead }))
}

// Running subagents' context in chunks, one call after another; a poll still running skips the next one.
async function pollAgents($: EngineInterface): Promise<void> {
  if (isPolling) return
  isPolling = true
  try {
    if (!(await readSettings($)).mods.savvy.enabled) return
    if ((await read($, run)).slug === null) return
    const list = (await $.agent.list()) as { id: string; status: string }[]
    const ids = list.filter(info => info.status === 'running').slice(0, MAX_AGENTS).map(info => String(info.id))
    const found: CtxState['agents'] = []
    for (const chunk of idChunks(ids)) {
      const out = await runScript($, 'ledger', ['agent-ctx', ...chunk, '--json'], TIMEOUT_MS.agentCtx, guardAgentCtx)
      found.push(...pairUp(chunk, out.ok ? out.value : null))
    }
    await update($, ctx, prev => ({ ...prev, agents: found }))
    await $.ui.invalidate('ui.render')
  } catch {
    // The rows keep their last counts; the next poll tries again.
  } finally {
    isPolling = false
  }
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
  const after = await read($, run)
  if (after.slug !== null) await refreshLead($, root, after.slug)
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
  if (agentTimer !== undefined) void agentTimer.cancel()
  agentTimer = undefined
}

async function ensureTimer($: EngineInterface): Promise<void> {
  if (timer !== undefined) return
  const settings = await readSettings($)
  if (!settings.mods.savvy.enabled) return
  timer = $.clock.every(TICK_MS, () => tick($))
  agentTimer = $.clock.every(POLL_MS, () => pollAgents($))
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

async function resetCounts($: EngineInterface): Promise<void> {
  try {
    await update($, ctx, () => EMPTY_CTX)
  } catch {
    // The counts stay as they were; the next poll replaces them.
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
  const output = parseOutputText(head)
  const base = BASE_LINE.exec(head)
  const tier = TIER_LINE.exec(head)
  return {
    step: output === null ? null : output.step,
    role: output === null ? null : output.role,
    name: null,
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
  // The shell owns the unmatched `session.start` and `agent.spawn` hooks; a match-all pattern keeps Savvy's own apart from them.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Show the progress of the active aico run' })
    } catch {
      // The command is a convenience; the view works without it.
    }
    stopTimer()
    lastSignature = ''
    lastPollMs = 0
    lastLeadKey = ''
    void resetCounts($)
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
