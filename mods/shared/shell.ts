import type { On } from 'claude-code'

import { refreshSettings } from './settings'
import { resetScriptCaller } from './run-script'
import { resetStatus } from './status'

// The shell every mod plugs into. No hook here waits for a script: a field fills when its call settles.
export function registerShell(on: On): void {
  on('session.start', async ($, e, next) => {
    resetScriptCaller()
    resetStatus()
    void refreshSettings($).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) void refreshSettings($).catch(() => undefined)
    return next(e)
  })
}
