import type { EngineInterface, On } from 'claude-code'

import { isModelSend, isResumeSpawn, judgeRun, refusalReason } from './lib/fresh-step.mjs'
import { TIMEOUT_MS } from './shared/run-script'

const GRACE_MS = 500

// The validator wants a matcher where more than one hook stands on one event; this one matches every value.
const ANY = /^/

type Verdict = 'pass' | 'active' | 'unreadable'

async function hasWorkFolder($: EngineInterface, root: string): Promise<boolean> {
  try {
    await $.fs.stat(`${root}/.company/work`)
    return true
  } catch {
    return false
  }
}

// `node <plugin>/scripts/run-state.mjs active --json`, no shell, its own call (not the shared script caller, whose
// give-up state belongs to the other mods). A surface without `$.process` throws a TypeError at the call itself: 'pass'.
// Every other failure is 'unreadable'.
async function runStateVerdict($: EngineInterface): Promise<Verdict> {
  const stop = new AbortController()
  try {
    const cwd = await $.session.root()
    if (!(await hasWorkFolder($, cwd))) return 'pass'
    const argv = ['node', `${$.plugin.root}/scripts/run-state.mjs`, 'active', '--json']
    let call: Promise<unknown>
    try {
      call = $.process.run(argv, { cwd, timeoutMs: TIMEOUT_MS.runState })
    } catch (error) {
      if (error instanceof TypeError) return 'pass'
      return 'unreadable'
    }
    const deadline = new Promise<'timeout'>(resolve => {
      void $.clock.sleep(TIMEOUT_MS.runState + GRACE_MS, { signal: stop.signal }).then(
        () => resolve('timeout'),
        () => undefined,
      )
    })
    const result = await Promise.race([call, deadline])
    if (result === 'timeout') return 'unreadable'
    const judged = judgeRun(result)
    return judged === 'idle' ? 'pass' : judged
  } catch {
    return 'unreadable'
  } finally {
    stop.abort()
  }
}

// null = the event goes on; a string = the reason it is refused.
async function refusal($: EngineInterface): Promise<string | null> {
  const verdict = await runStateVerdict($)
  return verdict === 'pass' ? null : refusalReason(verdict === 'unreadable')
}

// Steps are never resumed while a run is active (pipeline §2). Always on: no setting, no view, no status part.
// A model send and a resuming spawn are refused when the run state names a run, or cannot be read.
export function registerFreshStep(on: On): void {
  on('session.send', async ($, e, next) => {
    if (!isModelSend(e)) return next(e)
    const reason = await refusal($)
    return reason === null ? next(e) : { isDelivered: false as const, reason }
  })

  on('agent.spawn', { subagentType: ANY }, async ($, e, next) => {
    if (!isResumeSpawn(e)) return next(e)
    const reason = await refusal($)
    return reason === null ? next(e) : { deny: reason }
  })
}
