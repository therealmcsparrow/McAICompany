import type { EngineInterface, On } from 'claude-code'

import { readyText } from '../lib/ready.mjs'

import { refreshSettings } from './settings'
import { resetScriptCaller } from './run-script'
import { resetStatus, showStatus } from './status'

// Once per session: the settings fill, then one toast names the mods that are on. No model call; nothing waits for it.
async function announceReady($: EngineInterface): Promise<void> {
  try {
    const s = await refreshSettings($)
    await $.ui.toast(readyText(s.mods, s.known))
  } catch {
    // The toast is a convenience; a failure leaves the session as it was.
  }
}

// The shell every mod plugs into. No hook here waits for a script: a field fills when its call settles.
export function registerShell(on: On): void {
  on('session.start', async ($, e, next) => {
    resetScriptCaller()
    resetStatus()
    void showStatus($)
    void announceReady($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) void refreshSettings($).catch(() => undefined)
    return next(e)
  })
}
