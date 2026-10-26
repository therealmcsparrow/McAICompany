import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import { EMPTY_CLOCK, cacheClock, clockLines, clockStatus, noteRequest, wrap } from './lib/cache-clock.mjs'
import { arr, guardRunActive, int, obj, oneOf, opt, pattern, str } from './lib/guard.mjs'
import { fit, fmtInt, UNKNOWN } from './lib/format.mjs'
import { composeStatus } from './lib/status.mjs'
import { TIMEOUT_MS, runScript } from './shared/run-script'
import { readSettings } from './shared/settings'
import { isViewSurface } from './shared/surface'
import type { AgentRow, CacheClockState, CostState, RunView } from '../types'

const PANE = 'aico-cost'
const COMMAND = 'aico-cost'
const TICK_MS = 2000
const POLL_MS = 10000
const MAX_AGENTS = 40
const MAX_BLOCKS = 16
const DEFAULT_WIDTH = 39
const PROMPT_HEAD = 65536
const LABEL_WIDTH = 12

type Counts = { in: number; cache_write: number; cache_read: number; out: number }
type CostRow = { kind: string; id: string; role: string; agent: string | null; state: 'reconciled' | 'unreconciled' | 'live'; tokens: Counts | null; spend: number | null }
type Report = { run: string; rows: CostRow[]; totals: { spend: number; cache_read: number; cache_write: number; cache_write_share: number }; not_reconciled: number }
// What the cost state's `report` holds: the active run's slug and the last guarded `ledger.mjs report --json --live` answer.
type Cost = { slug: string | null; data: Report | null }
type Line = { text: string; isTax: boolean }
type Entry = { type: string; row: AgentRow }

// The validator reads a state key from an atom declared in the file that uses it.
const costAtom = atom({ plugin: 'aico', key: 'cost' } as const, { known: true, report: { slug: null, data: null } } as CostState, { shape: 'v1' })
const clockAtom = atom({ plugin: 'aico', key: 'cacheClock' } as const, EMPTY_CLOCK as CacheClockState, { shape: 'v1' })
const EMPTY_AGENT: AgentRow = { step: null, role: null, name: null, baseCommit: null, tier: null, startedMs: 0, isRunning: false }
const agents = atom({ plugin: 'aico', key: 'agents' } as const, EMPTY_AGENT, { shape: 'v1' })

// Timers and bookkeeping only; no view draws from these.
let timer: { cancel: () => unknown } | undefined
let isForced = false
let lastPollMs = 0
let lastSignature = ''
let lastAgents = ''
let lastPart = ''

const OUTPUT_LINE = /^Output: \.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/(\d{2})-([a-z][a-z0-9-]{0,40})\.md$/m
const NAME_LINE = /^Name: ([^\r\n]{1,40})$/m
const ROLE = /^[a-z][a-z0-9-]{0,40}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

const count = int(0, Number.MAX_SAFE_INTEGER)
const share = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined)
const counts = obj({ in: count, cache_write: count, cache_read: count, out: count })
const costRow = obj({
  kind: str(20),
  id: str(16),
  role: str(41),
  agent: opt(str(64)),
  state: oneOf(['reconciled', 'unreconciled', 'live']),
  tokens: opt(counts),
  spend: opt(count),
})
// `ledger.mjs report <run> --json --live`: the allow-listed keys only; every number is an exact integer.
const guardReport = obj({
  v: int(1, 1),
  run: pattern(SLUG),
  rows: arr(costRow, 1000),
  totals: obj({ spend: count, cache_read: count, cache_write: count, cache_write_share: share }),
  not_reconciled: count,
})

function costOf(state: CostState): { known: boolean; cost: Cost } {
  const report = state.report as Cost | null
  const isShaped = report !== null && typeof report === 'object' && Object.hasOwn(report, 'slug')
  return { known: state.known, cost: isShaped ? report : { slug: null, data: null } }
}

function roleOf(type: string, row: AgentRow): string | null {
  if (row.role !== null) return row.role
  const bare = type.startsWith('aico:') ? type.slice(5) : type
  return ROLE.test(bare) ? bare : null
}

function pct(data: Report): string {
  return fmtInt(Math.round(data.totals.cache_write_share * 100))
}

function header(id: string, role: string | null, name: string | undefined): string {
  return `${id} ${role ?? UNKNOWN}${name === undefined ? '' : ` (${name})`}`
}

function cells(c: Counts | null, spend: number | null, word: string): [string, string][] {
  const v = (n: number | undefined) => (c === null || n === undefined ? word : fmtInt(n))
  return [
    ['in', v(c?.in)],
    ['write [tax]', v(c?.cache_write)],
    ['out', v(c?.out)],
    ['read', v(c?.cache_read)],
    ['spend', spend === null ? word : fmtInt(spend)],
  ]
}

function pairLines(pairs: [string, string][], width: number): Line[] {
  return pairs.map(([label, value]) => ({ text: fit(`${label.padEnd(LABEL_WIDTH)}${value}`, width), isTax: label.endsWith('[tax]') }))
}

// The pane as lines: the clock first, then one block per dispatch, then the run total.
function buildLines(
  cost: { known: boolean; cost: Cost },
  entries: Entry[],
  roles: Record<string, string>,
  clockText: string[],
  width: number,
): Line[] {
  const out: Line[] = []
  for (const line of clockText) for (const part of wrap(line, width)) out.push({ text: part, isTax: false })
  const { slug, data } = cost.cost
  if (slug === null) {
    out.push({ text: fit(cost.known ? 'No aico run is active.' : 'Cost: unknown', width), isTax: false })
    return out
  }
  if (data === null) {
    out.push({ text: fit('Cost: unknown', width), isTax: false })
    return out
  }
  const blocks: Line[][] = []
  for (const row of data.rows) {
    const name = Object.hasOwn(roles, row.role) ? roles[row.role] : undefined
    blocks.push([
      { text: fit(header(row.id, row.role, name), width), isTax: false },
      ...pairLines(cells(row.tokens, row.spend, 'unknown'), width),
    ])
  }
  for (const { type, row } of entries) {
    const role = roleOf(type, row)
    const name = row.name ?? (role !== null && Object.hasOwn(roles, role) ? roles[role] : undefined)
    blocks.push([
      { text: fit(header(row.step ?? UNKNOWN, role, name), width), isTax: false },
      ...pairLines(cells(null, null, 'running'), width),
    ])
  }
  if (blocks.length > MAX_BLOCKS) {
    out.push({ text: fit(`+${blocks.length - MAX_BLOCKS} earlier dispatches`, width), isTax: false })
  }
  for (const block of blocks.slice(-MAX_BLOCKS)) out.push(...block)
  out.push({ text: 'Run total', isTax: false })
  const t = data.totals
  out.push(...pairLines([['spend', fmtInt(t.spend)], ['read', fmtInt(t.cache_read)], ['write [tax]', fmtInt(t.cache_write)]], width))
  out.push({ text: fit(`cache write = ${pct(data)}% of spend [tax]`, width), isTax: true })
  return out
}

function paneWidth(e: RenderInput): number {
  const columns = (e.props as { bodyColumns?: unknown }).bodyColumns
  return typeof columns === 'number' && Number.isInteger(columns) && columns >= 10 && columns <= 400 ? columns : DEFAULT_WIDTH
}

async function runningEntries($: EngineInterface, skip: Set<string | null>): Promise<Entry[]> {
  let list: { id: string; type: string; status: string }[] = []
  try {
    list = (await $.agent.list()) as never
  } catch {
    list = []
  }
  const entries: Entry[] = []
  for (const info of list) {
    if (entries.length >= MAX_AGENTS) break
    if (info.status !== 'running' || skip.has(String(info.id))) continue
    entries.push({ type: String(info.type), row: await read($, memberOf(agents, { requestId: String(info.id) })) })
  }
  return entries
}

async function drawPane($: EngineInterface, e: RenderInput) {
  const settings = await readSettings($)
  if (!settings.mods.cache_tax.enabled) return undefined
  const cost = costOf(await read($, costAtom))
  const clock = cacheClock(await read($, clockAtom), await $.clock.now())
  const skip = new Set<string | null>((cost.cost.data?.rows ?? []).map(r => r.agent))
  const entries = cost.cost.slug === null ? [] : await runningEntries($, skip)
  const { Box, Text } = $.ui.resolve(e)
  const rows = buildLines(cost, entries, settings.roles, clockLines(clock), paneWidth(e))
  return (
    <Box flexDirection="column">
      {rows.map(row => (row.isTax ? <Text weight="bold">{row.text}</Text> : <Text>{row.text}</Text>))}
    </Box>
  )
}

// The status text for the cost part: `spend <n> tax <p>%` and the cache clock, only while a run is active.
function partOf(isOn: boolean, cost: { cost: Cost }, clock: CacheClockState, nowMs: number): string {
  if (!isOn || cost.cost.slug === null) return ''
  const spend = cost.cost.data === null ? 'spend ? tax ?%' : `spend ${fmtInt(cost.cost.data.totals.spend)} tax ${pct(cost.cost.data)}%`
  return `${spend} ${clockStatus(cacheClock(clock, nowMs))}`
}

// The status line is one per plugin and Savvy writes it every 2 s while a run is active: Cache Tax sets its part when it changes
// and clears the line only when Savvy is off, so it never wipes Savvy's text.
async function applyPart($: EngineInterface, part: string, isRedraw: boolean, isSavvyOn: boolean): Promise<void> {
  const isChanged = part !== lastPart
  lastPart = part
  if (isChanged && part !== '') $.ui.status(composeStatus({ cost: part }))
  if (isChanged && part === '' && !isSavvyOn) $.ui.status(undefined)
  if (isChanged || isRedraw) await $.ui.invalidate('ui.render')
}

async function stamp($: EngineInterface, path: string): Promise<string> {
  try {
    const s = await $.fs.stat(path)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return '-'
  }
}

async function openPane($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: 'Cache Tax' })
  } catch {
    // The status line carries the summary when no pane opens.
  }
}

async function readSlug($: EngineInterface): Promise<{ ok: true; slug: string | null } | { ok: false }> {
  const active = await runScript($, 'run-state', ['active', '--json'], TIMEOUT_MS.runState, guardRunActive)
  if (!active.ok) return { ok: false }
  const found = active.value as { slug: string | null; view: RunView | null }
  return { ok: true, slug: found.slug !== null && found.view !== null && found.view.state === 'running' ? found.slug : null }
}

async function tickOnce($: EngineInterface): Promise<void> {
  const settings = await readSettings($)
  if (!settings.mods.cache_tax.enabled) {
    stopTimer()
    await applyPart($, '', false, settings.mods.savvy.enabled)
    return
  }
  const nowMs = await $.clock.now()
  const root = await $.session.root()
  const stored = await read($, costAtom)
  let current = costOf(stored)
  let isDue = isForced
  let isRedraw = false
  isForced = false

  if (nowMs - lastPollMs >= POLL_MS) {
    lastPollMs = nowMs
    const found = await readSlug($)
    if (!found.ok) {
      await update($, costAtom, () => ({ known: false, report: { slug: current.cost.slug, data: null } }))
      current = { known: false, cost: { slug: current.cost.slug, data: null } }
    } else if (found.slug !== current.cost.slug) {
      const wasRunning = current.cost.slug !== null
      await update($, costAtom, () => ({ known: true, report: { slug: found.slug, data: null } }))
      current = { known: true, cost: { slug: found.slug, data: null } }
      lastSignature = ''
      isRedraw = true
      if (found.slug !== null && !wasRunning && settings.mods.cache_tax.pane === 'auto') await openPane($)
    } else if (current.cost.slug !== null && current.cost.data === null) {
      isDue = true
    }
  }

  const slug = current.cost.slug
  if (slug !== null) {
    const sig = await stamp($, `${root}/.company/ledger/${slug}.jsonl`)
    if (sig !== lastSignature) {
      lastSignature = sig
      isDue = true
    }
    if (isDue) {
      const r = await runScript($, 'ledger', ['report', slug, '--json', '--live'], TIMEOUT_MS.ledger, guardReport)
      const next: CostState = r.ok
        ? { known: true, report: { slug, data: r.value as Report } }
        : { known: false, report: { slug, data: null } }
      await update($, costAtom, () => next)
      current = costOf(next)
      isRedraw = true
    }
  }

  const ids = (await runningEntries($, new Set())).map(e => e.row.step ?? '').join(',')
  if (ids !== lastAgents) {
    lastAgents = ids
    isRedraw = true
  }
  const clock = await read($, clockAtom)
  await applyPart($, partOf(true, current, clock, nowMs), isRedraw, settings.mods.savvy.enabled)
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
  if (!settings.mods.cache_tax.enabled) return
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
    // Cache Tax stays quiet when it cannot start.
  }
}

// The time of a main-loop request is the only thing the clock keeps; it lives in session state and is never written out.
async function noteMainRequest($: EngineInterface): Promise<void> {
  try {
    const settings = await readSettings($)
    if (!settings.mods.cache_tax.enabled) return
    const nowMs = await $.clock.now()
    await update($, clockAtom, prev => noteRequest(prev, nowMs) as CacheClockState)
    void ensureTimer($).catch(() => undefined)
  } catch {
    // A request is never held up by Cache Tax.
  }
}

async function noteSpawn($: EngineInterface, prompt: unknown, agentId: unknown): Promise<void> {
  try {
    if (typeof agentId !== 'string') return
    const settings = await readSettings($)
    if (!settings.mods.cache_tax.enabled) return
    const head = typeof prompt === 'string' ? prompt.slice(0, PROMPT_HEAD).replace(/\r\n?/g, '\n') : ''
    const output = OUTPUT_LINE.exec(head)
    const name = NAME_LINE.exec(head)
    const row: AgentRow = {
      ...EMPTY_AGENT,
      step: output === null ? null : output[2],
      role: output === null ? null : output[3],
      name: name === null ? null : fit(name[1], 40),
      startedMs: await $.clock.now(),
      isRunning: true,
    }
    await update($, memberOf(agents, { requestId: agentId }), () => row)
    isForced = true
    await $.ui.invalidate('ui.render')
  } catch {
    // A spawn is never held up by Cache Tax.
  }
}

async function runCommand($: EngineInterface): Promise<{ text: string }> {
  const settings = await readSettings($)
  if (!settings.mods.cache_tax.enabled) return { text: 'cache tax is off; switch it on in /aico:settings' }
  const cost = costOf(await read($, costAtom))
  await openPane($)
  if (!cost.known) return { text: 'Cache Tax pane opened; the run state is unknown.' }
  return { text: cost.cost.slug === null ? 'Cache Tax pane opened. No aico run is active.' : 'Cache Tax pane opened.' }
}

export function registerCacheTax(on: On): void {
  // The shell owns the unmatched `session.start` hook; a match-all pattern keeps this one apart from it.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Show the tokens of the active aico run and the Lead cache clock' })
    } catch {
      // The command is a convenience; the view works without it.
    }
    stopTimer()
    lastPollMs = 0
    lastSignature = ''
    lastAgents = ''
    lastPart = ''
    void begin($)
    return next(e)
  })

  // A request of the main loop restarts the Lead's cache entry; a subagent's request does not.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await noteMainRequest($)
    return yield* next(e)
  })

  on('agent.spawn', { subagentType: /./ }, async ($, e, next) => {
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
