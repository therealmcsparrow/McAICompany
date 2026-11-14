import type { Register } from 'claude-code'

import { registerCacheTax } from '../mods/cache-tax'
import { registerFreshStep } from '../mods/fresh-step'
import { registerPlanGate } from '../mods/plan-gate'
import { registerReflect } from '../mods/reflect'
import { registerRepromptGate } from '../mods/reprompt-gate'
import { registerSavings } from '../mods/savings'
import { registerSavvy } from '../mods/savvy'
import { registerShell } from '../mods/shared/shell'
import { registerSwitchboard } from '../mods/switchboard'

export const register: Register = on => {
  registerShell(on)
  registerSavvy(on)
  registerCacheTax(on)
  registerReflect(on)
  registerSwitchboard(on)
  registerSavings(on)
  registerPlanGate(on)
  registerFreshStep(on)
  // Last, so the other mods' guards keep answering for their own failures as before.
  registerRepromptGate(on)
}
