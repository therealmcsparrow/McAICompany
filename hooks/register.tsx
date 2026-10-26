import type { Register } from 'claude-code'

import { registerBlastRadius } from '../mods/blast-radius'
import { registerCacheTax } from '../mods/cache-tax'
import { registerReflect } from '../mods/reflect'
import { registerSavvy } from '../mods/savvy'
import { registerShell } from '../mods/shared/shell'

export const register: Register = on => {
  registerShell(on)
  registerSavvy(on)
  registerCacheTax(on)
  registerReflect(on)
  registerBlastRadius(on)
}
