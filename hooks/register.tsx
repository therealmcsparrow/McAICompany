import type { Register } from 'claude-code'

import { registerShell } from '../mods/shared/shell'

export const register: Register = on => {
  registerShell(on)
}
