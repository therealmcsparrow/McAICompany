import type { Register } from 'claude-code'

import { registerBlastRadius } from '../mods/blast-radius'
import { registerSavvy } from '../mods/savvy'
import { registerShell } from '../mods/shared/shell'

export const register: Register = on => {
  registerShell(on)
  registerSavvy(on)
  registerBlastRadius(on)
}
