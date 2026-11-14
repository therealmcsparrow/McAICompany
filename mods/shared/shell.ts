import type { EngineInterface, On } from 'claude-code'

import { readyText } from '../lib/ready.mjs'
import { modsFlags } from '../lib/switchboard.mjs'
import { parseVersion } from '../lib/version.mjs'

import { refreshSettings } from './settings'
import { TIMEOUT_MS, resetScriptCaller, runScript } from './run-script'
import { resetStatus, setStatusPart, showStatus } from './status'

const MANIFEST_MAX = 65536
const DISCOVERY = 'aico: /aico-mods shows your safety rules and settings. /aico-savings shows token use.'

// The plugin's own version from its plugin.json; undefined when the file is unreadable or the version is not x.y.z.
async function readVersion($: EngineInterface): Promise<string | undefined> {
  try {
    const path = `${$.plugin.root}/.claude-plugin/plugin.json`
    const s = await $.fs.stat(path)
    if (s.isLink || s.kind !== 'file' || s.size > MANIFEST_MAX) return undefined
    return parseVersion(await $.fs.read(path))
  } catch {
    return undefined
  }
}

// One toast, only while `mods.switchboard.seen` reads false; opening the pane sets it. Needs a second read: the shared settings guard drops that key.
async function discoveryToast($: EngineInterface): Promise<void> {
  try {
    const r = await runScript($, 'settings', ['get'], TIMEOUT_MS.get, v => v)
    if (!r.ok) return
    const flags = modsFlags(r.value) as Record<string, { seen?: boolean }> | undefined
    if (flags !== undefined && Object.hasOwn(flags, 'switchboard') && flags.switchboard?.seen === false) await $.ui.toast(DISCOVERY)
  } catch {
    // The toast is a convenience; a failure leaves the session as it was.
  }
}

// Once per session: the version goes first on the status line, the settings fill, then one toast names the mods that are on.
// No model call; nothing waits for it.
async function announceReady($: EngineInterface): Promise<void> {
  const version = readVersion($)
  void version.then(v => (v === undefined ? undefined : setStatusPart($, 'version', `v${v}`)))
  try {
    const s = await refreshSettings($)
    await $.ui.toast(readyText(s.mods, s.known, await version))
    await discoveryToast($)
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
