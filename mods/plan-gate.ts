import type { EngineInterface, On } from 'claude-code'

import { TEXT, WRITE_TOOLS, decideVerify, ownFailure, parseGateCommand, recordPath, writeTarget } from './lib/plan-gate.mjs'

const VERIFY_MS = 5000
const GRACE_MS = 500

// The validator wants a matcher where more than one hook stands on one event; this one matches every value.
const ANY = /^/

type Verdict = { decision: 'deny'; reason: string }
type Run = { exitCode?: unknown; stdout?: unknown; isStdoutTruncated?: unknown } | null
type Outcome = { run: Run } | { missing: true }

// The policy of the last `verify` answer this session. Bookkeeping only: no view draws from it, and it never allows anything alone.
let lastPolicy: string | null = null

function shellOf(tool: string): boolean {
  return tool === 'Bash' || tool === 'PowerShell'
}

function commandOf(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : null
}

function deny(reason: string): Verdict {
  return { decision: 'deny', reason }
}

// The toast only tells the CEO; it decides nothing, so a failure to show it is dropped.
function tell($: EngineInterface, text: string): void {
  try {
    $.ui.toast(text)
  } catch {
    // dropped
  }
}

// `node <plugin>/scripts/plan-check.mjs verify <slug> --json`, no shell. A surface without `$.process` is { missing }.
async function verify($: EngineInterface, slug: string): Promise<Outcome> {
  const stop = new AbortController()
  try {
    const cwd = await $.session.root()
    const argv = ['node', `${$.plugin.root}/scripts/plan-check.mjs`, 'verify', slug, '--json']
    const deadline = new Promise<'timeout'>(resolve => {
      void $.clock.sleep(VERIFY_MS + GRACE_MS, { signal: stop.signal }).then(
        () => resolve('timeout'),
        () => undefined,
      )
    })
    const result = await Promise.race([$.process.run(argv, { cwd, timeoutMs: VERIFY_MS }), deadline])
    return { run: result === 'timeout' ? null : (result as Run) }
  } catch (error) {
    if (error instanceof TypeError) return { missing: true }
    return { run: null }
  } finally {
    stop.abort()
  }
}

// The answer for one slug: a verdict to return, or null to go on (a toast may have been shown).
async function judge($: EngineInterface, slug: string): Promise<{ block: Verdict | null; toast: string }> {
  const outcome = await verify($, slug)
  if ('missing' in outcome) return { block: lastPolicy === 'block' ? deny(TEXT.denyError) : null, toast: '' }
  const decision = decideVerify(outcome.run, lastPolicy)
  if (decision.policy !== null) lastPolicy = decision.policy
  if (decision.action === 'deny') return { block: deny(decision.text), toast: '' }
  return { block: null, toast: decision.action === 'toast' ? decision.text : '' }
}

// The plan Gate, explained early. It judges only the two exact forms of `run-state gate <slug> plan passed`; the scripts
// refuse every other form, a forged record and a linked plan themselves.
export function registerPlanGate(on: On): void {
  on('tool.check', { tool: ANY }, async ($, e, next) => {
    const command = shellOf(e.tool) ? commandOf(e.input) : null
    if (command !== null) {
      const slug = parseGateCommand(command)
      if (slug === null) return next(e)
      const judged = await judge($, slug)
      if (judged.block !== null) return judged.block
      const verdict = await next(e)
      if (verdict.decision !== 'deny' && judged.toast !== '') tell($, judged.toast)
      return verdict
    }
    if (WRITE_TOOLS.includes(e.tool)) {
      const target = writeTarget(e.input)
      const record = target === null ? null : recordPath(target)
      if (record === null) return next(e)
      if (record.slug === null) return lastPolicy === 'block' ? deny(TEXT.denyRecord) : next(e)
      const judged = await judge($, record.slug)
      if (lastPolicy === 'block' || judged.block !== null) return deny(TEXT.denyRecord)
      return next(e)
    }
    return next(e)
  }).catch(($, e, next) => {
    try {
      const command = shellOf(e.tool) ? commandOf(e.input) : null
      const target = WRITE_TOOLS.includes(e.tool) ? writeTarget(e.input) : null
      const judged = (command !== null && parseGateCommand(command) !== null) || (target !== null && recordPath(target) !== null)
      if (judged && ownFailure(lastPolicy) === 'deny') return deny(TEXT.failed)
    } catch {
      return deny(TEXT.failed)
    }
    return next(e)
  })
}
