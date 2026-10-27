import type { EngineInterface, On } from 'claude-code'

import { allowsTool, armLive, checkSpawn, guardArmed, isReprompter, refusalReason, refusalToast, remember, runEnded } from './lib/reprompt-gate.mjs'
import { TIMEOUT_MS, runScript } from './shared/run-script'

const MAX_REPROMPTERS = 50
const MAX_OTHERS = 200
const RUN_STATE_MAX = 65536

// The validator wants a matcher where more than one hook stands on one event; this one matches every value.
const ANY = /^/

const BAD_DISPATCH = 'aico reprompt gate: bad reprompter dispatch'
const NOT_ARMED = 'aico reprompt gate: cannot arm the gate; reprompt refused'
const FAILED = 'aico reprompt gate failed; reprompt refused'
const NOT_STARTED = 'aico reprompt gate: this reprompter was not started through the gate'
const UNKNOWN_AGENT = 'aico reprompt gate: unknown agent during a reprompt run; refused'

type Armed = { slug: string; nn: string; root: string }
type Check = { tool: string; input: unknown; agentId?: string; isReadOnly?: true }
type Verdict = { decision: 'deny'; reason: string }

// Reprompters this session started through the gate, and other agents seen at their spawn. Bookkeeping only: no view draws from it.
const reprompters = new Map<string, Armed>()
const others = new Map<string, true>()
// Runs armed by this gate in this session, by slug. Never filled from disk: a marker file arms nothing.
const armedRuns = new Map<string, Armed & { at: number }>()

// After an error: only a recorded reprompter, or an unrecorded agent while a run is armed, is refused.
function passesOnError(id: string | undefined): boolean {
  return id === undefined || others.has(id) || (!reprompters.has(id) && armedRuns.size === 0)
}

function deny(reason: string): Verdict {
  return { decision: 'deny', reason }
}

// A refusal is told to the CEO; the toast and the log never decide anything, so a failure there is dropped.
function tell($: EngineInterface, text: string): void {
  try {
    void Promise.resolve($.ui.toast(text)).catch(() => undefined)
    void Promise.resolve($.ui.log(text)).catch(() => undefined)
  } catch {
    // The call is already refused; the notice is a convenience.
  }
}

async function arm($: EngineInterface, spec: { slug: string; nn: string }): Promise<boolean> {
  const r = await runScript($, 'reprompt-check', ['arm', spec.slug, spec.nn], TIMEOUT_MS.arm, guardArmed(spec.nn))
  return r.ok
}

// The agent is not recorded (a reload, an engine fork, a workflow agent): the list says what it is.
async function judgeUnrecorded($: EngineInterface, id: string): Promise<'reprompter' | 'other' | 'unknown'> {
  try {
    const row = (await $.agent.list()).find(item => item.id === id)
    if (row === undefined) return 'unknown'
    return isReprompter(row.type) ? 'reprompter' : 'other'
  } catch {
    return 'unknown'
  }
}

// Whether a reprompt run is armed. An empty map costs no file read; disk is read only to disarm a run.
async function isArmed($: EngineInterface): Promise<boolean> {
  if (armedRuns.size === 0) return false
  const now = await $.clock.now()
  for (const [slug, entry] of [...armedRuns]) {
    try {
      const dir = `${entry.root}/.company/work/${entry.slug}`
      const markerFile = await isPlainFile($, `${dir}/.gate-${entry.nn}`)
      const ended = markerFile && (await runStateEnded($, `${dir}/run-state.jsonl`))
      if (!armLive(entry, now, { markerFile, ended })) armedRuns.delete(slug)
    } catch {
      // An unexpected error keeps the entry; the timeout still bounds it.
    }
  }
  return armedRuns.size > 0
}

async function isPlainFile($: EngineInterface, path: string): Promise<boolean> {
  try {
    const s = await $.fs.stat(path)
    return !s.isLink && s.kind === 'file'
  } catch {
    return false
  }
}

// Unreadable, missing, linked or too large all read as "not ended".
async function runStateEnded($: EngineInterface, path: string): Promise<boolean> {
  try {
    const s = await $.fs.stat(path)
    if (s.isLink || s.kind !== 'file' || s.size > RUN_STATE_MAX) return false
    return runEnded(await $.fs.read(path))
  } catch {
    return false
  }
}

// null = the call goes on to `next`; a verdict = refused here. Nothing in here calls `next`.
async function judge($: EngineInterface, e: Check): Promise<Verdict | null> {
  const id = e.agentId
  if (id === undefined) return null
  const mine = reprompters.get(id)
  if (mine !== undefined) {
    if (allowsTool(e.tool, e.input, mine, $.plugin.root)) return null
    tell($, refusalToast(e.tool, e.input))
    return deny(refusalReason(e.tool))
  }
  if (others.has(id)) return null
  const kind = await judgeUnrecorded($, id)
  if (kind === 'other') {
    remember(others, id, true, MAX_OTHERS)
    return null
  }
  if (kind === 'unknown' && (e.isReadOnly === true || !(await isArmed($)))) return null
  tell($, refusalToast(e.tool, e.input))
  return deny(kind === 'reprompter' ? NOT_STARTED : UNKNOWN_AGENT)
}

// The spawn of a reprompter: its place in the session, or the refusal. Nothing in here calls `next`.
async function admit($: EngineInterface, e: Parameters<typeof checkSpawn>[0]): Promise<{ deny: string } | Armed> {
  try {
    const root = await $.session.root()
    const spec = checkSpawn(e, root)
    if (spec === null) return { deny: BAD_DISPATCH }
    if (!(await arm($, spec))) return { deny: NOT_ARMED }
    remember(armedRuns, spec.slug, { slug: spec.slug, nn: spec.nn, root, at: await $.clock.now() }, MAX_REPROMPTERS)
    return { slug: spec.slug, nn: spec.nn, root }
  } catch {
    return { deny: FAILED }
  }
}

// The reprompt write gate: an allow-list for the reprompter's own tool calls. It never answers `allow`;
// an allowed call goes to `next`, so the session's own rules still decide it. Always on.
export function registerRepromptGate(on: On): void {
  on('agent.spawn', { subagentType: ANY }, async ($, e, next) => {
    if (!isReprompter(e.subagentType)) {
      const started = await next(e)
      if (typeof started.agentId === 'string') remember(others, started.agentId, true, MAX_OTHERS)
      return started
    }
    const admitted = await admit($, e)
    if ('deny' in admitted) return admitted
    const started = await next(e)
    if (typeof started.agentId === 'string') remember(reprompters, started.agentId, admitted, MAX_REPROMPTERS)
    return started
  }).catch(($, e, next) => (next.called || !isReprompter(e.subagentType) ? next(e) : { deny: FAILED }))

  on('tool.check', { tool: ANY }, async ($, e, next) => {
    let verdict: Verdict | null
    try {
      verdict = await judge($, e)
    } catch {
      verdict = passesOnError(e.agentId) ? null : deny(FAILED)
    }
    return verdict ?? next(e)
  }).catch(($, e, next) => (passesOnError(e.agentId) ? next(e) : deny(FAILED)))
}
