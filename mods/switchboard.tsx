import type { EngineInterface, On, RenderInput } from 'claude-code'

import { denyLines, lockedMessage, modsFlags, parseManifest, parseSetMod, rows, toggledMessage } from './lib/switchboard.mjs'
import { trimEol } from './lib/guard.mjs'
import { isViewSurface } from './shared/surface'

const PANE = 'aico-mods'
const COMMAND = 'aico-mods'
const SELF = 'switchboard'
const READ_MS = 3000
const WRITE_MS = 5000
const MAX_STDOUT = 262144
const MAX_MANIFEST = 8192
const MAX_FILES = 64
const FILE = /^[a-z][a-z0-9-]{0,40}\.json$/

type Manifest = NonNullable<ReturnType<typeof parseManifest>>
type Row = { id: string; title: string; kind: string; state: string; canChange: boolean; key: string | null; detail: string }
type Flags = Record<string, { enabled?: boolean; seen?: boolean }>
type Run = { exitCode: number; stdout: string } | undefined

// The line under the keys line, and the savers switched in this pane that the next task step picks up.
let message = ''
const pending = new Map<string, boolean>()
let seenKey: string | undefined
let isSeenSent = false

function reset(): void {
  message = ''
  pending.clear()
  seenKey = undefined
  isSeenSent = false
}

// Runs `node <plugin>/scripts/<script>.mjs <args>` with no shell; undefined on any failure.
async function run($: EngineInterface, script: string, args: readonly string[], timeoutMs: number): Promise<Run> {
  try {
    const cwd = await $.session.root()
    const result = await $.process.run(['node', `${$.plugin.root}/scripts/${script}.mjs`, ...args], { cwd, timeoutMs })
    const out = result as { exitCode?: unknown; stdout?: unknown; isStdoutTruncated?: unknown }
    if (typeof out.exitCode !== 'number' || typeof out.stdout !== 'string' || out.isStdoutTruncated === true || out.stdout.length > MAX_STDOUT) return undefined
    return { exitCode: out.exitCode, stdout: trimEol(out.stdout) }
  } catch {
    return undefined
  }
}

async function readFlags($: EngineInterface): Promise<Flags | undefined> {
  const r = await run($, 'settings', ['get'], READ_MS)
  return r === undefined || r.exitCode !== 0 ? undefined : (modsFlags(r.stdout) as Flags | undefined)
}

async function readManifests($: EngineInterface): Promise<Manifest[]> {
  const dir = `${$.plugin.root}/hooks/manifests`
  const found: Manifest[] = []
  try {
    const list = await $.fs.list(dir)
    for (const entry of list.slice(0, MAX_FILES)) {
      if (entry.kind !== 'file' || !FILE.test(entry.name)) continue
      try {
        const path = `${dir}/${entry.name}`
        const s = await $.fs.stat(path)
        if (s.isLink || s.kind !== 'file' || s.size > MAX_MANIFEST) continue
        const m = parseManifest(await $.fs.read(path)) as Manifest | undefined
        if (m !== undefined && `${m.id}.json` === entry.name) found.push(m)
      } catch {
        // One unreadable manifest is left out; the others still draw.
      }
    }
  } catch {
    return []
  }
  return found
}

// The engine's session key: the first 12 hex characters of the SHA-256 of the session id.
async function sessionKey($: EngineInterface): Promise<string> {
  if (seenKey !== undefined) return seenKey
  let id = ''
  try {
    id = String(await $.session.id())
  } catch {
    id = ''
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
    seenKey = Array.from(new Uint8Array(digest).slice(0, 6), b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    seenKey = '000000000000'
  }
  return seenKey
}

async function readDenies($: EngineInterface): Promise<string[]> {
  const r = await run($, 'hook-check', ['denies', '--session', await sessionKey($), '--json'], READ_MS)
  return r === undefined || r.exitCode !== 0 ? [] : (denyLines(r.stdout) as string[])
}

function shown(row: Row): string {
  if (!pending.has(row.id)) return row.state
  return `${pending.get(row.id) === true ? 'ON' : 'OFF'} (pending)`
}

async function toggle($: EngineInterface, row: Row): Promise<void> {
  try {
    if (row.kind !== 'saver') {
      message = lockedMessage(row.id)
    } else if (!row.canChange) {
      message = 'Savers cannot change now. See the line above.'
    } else {
      const isOn = pending.has(row.id) ? pending.get(row.id) === true : row.state === 'ON'
      const r = await run($, 'settings', ['set-mod', row.id, isOn ? 'off' : 'on'], WRITE_MS)
      const answer = parseSetMod(r) as { ok: true } | { ok: false; message: string }
      if (answer.ok) {
        pending.set(row.id, !isOn)
        message = toggledMessage(row.id, !isOn)
      } else {
        message = answer.message
      }
    }
  } catch {
    message = 'aico could not change that setting.'
  }
  try {
    await $.ui.invalidate('ui.render')
  } catch {
    // The next render shows the message.
  }
}

async function drawPane($: EngineInterface, e: RenderInput) {
  const flags = await readFlags($)
  if (flags !== undefined && Object.hasOwn(flags, SELF) && flags[SELF]?.enabled === false) return undefined
  const manifests = await readManifests($)
  const mods = Object.fromEntries(Object.entries(flags ?? {}).map(([key, one]) => [key, one]))
  const table = rows(manifests, { known: flags !== undefined, mods }) as { guards: Row[]; savers: Row[] }
  const denies = await readDenies($)
  const { Box, Text, Button } = $.ui.resolve(e)
  const line = message !== '' ? message : flags === undefined ? 'aico cannot read mod settings. Guards deny, savers pass. Fix the settings file, then reopen.' : ' '
  const button = (row: Row) => (
    <Box key={`group-${row.id}`} flexDirection="column">
      <Button key={`row-${row.id}`} onPress={() => void toggle($, row)}>
        {`${row.title}  ${shown(row)}`}
      </Button>
      <Text>{row.detail}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Text weight="bold">aico mods</Text>
      <Text>Keys: Up/Down move, Space toggles, Esc closes.</Text>
      <Text>{line}</Text>
      <Text weight="bold">GUARDS (safety rules, always on, locked)</Text>
      {table.guards.map(button)}
      <Text weight="bold">SAVERS (main chat only, optional)</Text>
      {table.savers.length === 0 ? <Text>No savers installed.</Text> : table.savers.map(button)}
      <Text weight="bold">RECENT DENIES (this session, newest first, up to 5)</Text>
      {denies.length === 0 ? <Text>No denies this session.</Text> : denies.map(d => <Text>{d}</Text>)}
      <Text>Changes apply when the next task step starts.</Text>
    </Box>
  )
}

// The first open of the pane marks the discovery flag; it is sent once per session and only while the flag reads false.
async function markSeen($: EngineInterface): Promise<void> {
  if (isSeenSent) return
  const flags = await readFlags($)
  if (flags === undefined || flags[SELF]?.seen !== false) return
  isSeenSent = true
  await run($, 'settings', ['set-mod', SELF, 'seen'], WRITE_MS)
}

async function openPane($: EngineInterface): Promise<{ text: string }> {
  const flags = await readFlags($)
  if (flags !== undefined && flags[SELF]?.enabled === false) return { text: 'switchboard is off; switch it on in /aico:settings' }
  message = ''
  await markSeen($)
  try {
    await $.ui.open({ id: PANE, title: 'aico mods' })
  } catch {
    return { text: 'aico mods could not open a pane here.' }
  }
  return { text: 'aico mods opened.' }
}

export function registerSwitchboard(on: On): void {
  // A match pattern of its own keeps this hook apart from the shell's and Cache Tax's `session.start`.
  on('session.start', { cwd: /./ }, async ($, e, next) => {
    reset()
    try {
      await $.command.register({ name: COMMAND, description: 'Show the aico safety rules, switch savers and list recent denies' })
    } catch {
      // The command is a convenience; the pane works without it.
    }
    return next(e)
  })

  // A saver switched here takes effect at the next task step: a dispatch ends the pending mark.
  on('agent.spawn', { subagentType: /^/ }, async ($, e, next) => {
    if (e.resume === undefined) pending.clear()
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => openPane($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!isViewSurface(e.surface)) return next(e)
    try {
      const tree = await drawPane($, e)
      return tree === undefined ? next(e) : tree
    } catch {
      return next(e)
    }
  })
}
