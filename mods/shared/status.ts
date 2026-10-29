import type { EngineInterface } from 'claude-code'

import { composeStatus } from '../lib/status.mjs'

export type StatusKey = 'version' | 'savvy' | 'blast' | 'cost' | 'reflect'

const KEYS: readonly string[] = ['version', 'savvy', 'blast', 'cost', 'reflect']
const NOT_WRITTEN = Symbol('not written')

// The parts live here and not in an atom: no view draws from them. The line is built before the first await,
// so the newest call always carries every part.
const parts: Record<string, string> = Object.create(null)
let lastLine: string | undefined | typeof NOT_WRITTEN = NOT_WRITTEN

// Forgets every part and the last written line; writes nothing. The next line built is always written.
export function resetStatus(): void {
  for (const key of Object.keys(parts)) delete parts[key]
  lastLine = NOT_WRITTEN
}

// The only caller of `$.ui.status`. Sets or (with `undefined` or an empty text) removes one part. Never throws.
export async function setStatusPart($: EngineInterface, key: StatusKey, text: string | undefined): Promise<void> {
  try {
    if (!KEYS.includes(key)) return
    if (typeof text === 'string' && text !== '') parts[key] = text
    else delete parts[key]
    await writeLine($)
  } catch {
    // A status part is a convenience; nothing here may reach a hook.
  }
}

// Writes the line as it stands now (the idle part when no run part is set). Used at session start. Never throws.
export async function showStatus($: EngineInterface): Promise<void> {
  try {
    await writeLine($)
  } catch {
    // Same as above.
  }
}

async function writeLine($: EngineInterface): Promise<void> {
  const line: string | undefined = composeStatus(parts, { idle: true })
  if (line === lastLine) return
  lastLine = line
  try {
    await $.ui.status(line)
  } catch {
    if (lastLine === line) lastLine = NOT_WRITTEN
  }
}
