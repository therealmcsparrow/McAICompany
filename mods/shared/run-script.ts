import type { EngineInterface } from 'claude-code'

import { interpretRun } from '../lib/guard.mjs'

// Per-script time limits in milliseconds (`aico-mods` v1, "Calling a script").
export const TIMEOUT_MS = {
  get: 1000,
  runState: 1000,
  ledger: 5000,
  step: 5000,
  lessons: 5000,
  depthPre: 5000,
  depthGate: 10000,
  retro: 10000,
  arm: 5000,
  agentCtx: 5000,
  leadCtx: 1000,
} as const

export type ScriptName = 'settings' | 'run-state' | 'ledger' | 'lead-handover' | 'reflect' | 'lessons' | 'review-depth' | 'reprompt-check'
export type ScriptResult<T> = { ok: true; value: T } | { ok: false; reason: string }
type Guard<T> = (value: unknown) => T | undefined

const GRACE_MS = 500
const GIVE_UP_AFTER = 3

// Kept only so a surface where every call fails is not called again and again; no view draws from it.
let rejections = 0
let hasSucceeded = false
let isMissing = false

export function resetScriptCaller(): void {
  rejections = 0
  hasSucceeded = false
  isMissing = false
}

function isBroken(): boolean {
  return isMissing || (!hasSucceeded && rejections >= GIVE_UP_AFTER)
}

// Runs `node <plugin>/scripts/<script>.mjs <args>` with no shell. Never throws: every failure is { ok: false }.
export async function runScript<T>(
  $: EngineInterface,
  script: ScriptName,
  args: readonly string[],
  timeoutMs: number,
  guard: Guard<T>,
): Promise<ScriptResult<T>> {
  if (isBroken()) return { ok: false, reason: 'unavailable' }
  const stop = new AbortController()
  try {
    const cwd = await $.session.root()
    const argv = ['node', `${$.plugin.root}/scripts/${script}.mjs`, ...args]
    const deadline = new Promise<'timeout'>(resolve => {
      void $.clock.sleep(timeoutMs + GRACE_MS, { signal: stop.signal }).then(
        () => resolve('timeout'),
        () => undefined,
      )
    })
    const result = await Promise.race([$.process.run(argv, { cwd, timeoutMs }), deadline])
    if (result === 'timeout') {
      rejections++
      return { ok: false, reason: 'timeout' }
    }
    hasSucceeded = true
    return interpretRun(result, guard) as ScriptResult<T>
  } catch (error) {
    // A surface without `$.process` fails the property read itself: that is unavailable for the session, not a rejection.
    if (error instanceof TypeError) {
      isMissing = true
      return { ok: false, reason: 'unavailable' }
    }
    rejections++
    return { ok: false, reason: 'rejected' }
  } finally {
    stop.abort()
  }
}
