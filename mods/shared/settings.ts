import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { MODS_DEFAULTS, guardSettings } from '../lib/guard.mjs'
import type { ModsSettings, SettingsState } from '../../types'
import { TIMEOUT_MS, runScript } from './run-script'

// The validator reads state keys from atoms declared in the file that uses them, so the
// settings atom lives here and the other files go through `readSettings`.
const settings = atom(
  { plugin: 'aico', key: 'settings' } as const,
  { known: false, mods: structuredClone(MODS_DEFAULTS) as ModsSettings, roles: {} } as SettingsState,
  { shape: 'v1' },
)

export async function readSettings($: EngineInterface): Promise<SettingsState> {
  return read($, settings)
}

// Reads the resolved settings; a failed call leaves the defaults and `known: false` (the views say `settings unknown`).
export async function refreshSettings($: EngineInterface): Promise<void> {
  const r = await runScript($, 'settings', ['get'], TIMEOUT_MS.get, guardSettings)
  const next: SettingsState = r.ok
    ? { known: true, mods: r.value.mods as ModsSettings, roles: Object.fromEntries(Object.entries(r.value.roles).map(([role, one]) => [role, (one as { name: string }).name])) }
    : { known: false, mods: structuredClone(MODS_DEFAULTS) as ModsSettings, roles: {} }
  await update($, settings, () => next)
}
