import type { EngineInterface, On, RenderInput } from 'claude-code'

import { trimEol } from './lib/guard.mjs'
import { baselineFigures, currentFigures, GUARDS_SINCE, paneLines, safeText } from './lib/savings.mjs'
import { modsFlags } from './lib/switchboard.mjs'
import { isViewSurface } from './shared/surface'

const PANE = 'aico-savings'
const COMMAND = 'aico-savings'
const SELF = 'savings'
const SEEN_OWNER = 'switchboard'
const READ_MS = 5000
const WRITE_MS = 5000
const MAX_STDOUT = 1048576
const DEFAULT_WIDTH = 80
const RUN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

type Flags = Record<string, { enabled?: boolean; seen?: boolean }>
type Out = { exitCode: number; stdout: string }
type Line = { text: string; bold: boolean }

let isSeenSent = false

// Runs `node <plugin>/scripts/<script>.mjs <args>` with no shell; undefined on any failure.
async function run($: EngineInterface, script: string, args: readonly string[], timeoutMs: number): Promise<Out | undefined> {
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

function parse(out: Out | undefined): unknown {
  if (out === undefined || out.exitCode !== 0) return undefined
  try {
    return JSON.parse(out.stdout)
  } catch {
    return undefined
  }
}

async function readFlags($: EngineInterface): Promise<Flags | undefined> {
  const r = await run($, 'settings', ['get'], READ_MS)
  return r === undefined || r.exitCode !== 0 ? undefined : (modsFlags(r.stdout) as Flags | undefined)
}

// A missing switch counts as on: the saver is on by default.
function isOff(flags: Flags | undefined): boolean {
  return flags !== undefined && Object.hasOwn(flags, SELF) && flags[SELF]?.enabled === false
}

function widthOf(e: RenderInput): number {
  const columns = (e.props as { bodyColumns?: unknown }).bodyColumns
  return typeof columns === 'number' && Number.isInteger(columns) && columns >= 10 && columns <= 400 ? columns : DEFAULT_WIDTH
}

// The slug of the active run, or null when none is active or the answer does not fit.
function activeSlug(answer: unknown): string | null | undefined {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return undefined
  const slug = (answer as { slug?: unknown }).slug
  if (slug === null) return null
  return typeof slug === 'string' && RUN_NAME.test(slug) ? slug : undefined
}

async function lines($: EngineInterface, columns: number): Promise<Line[]> {
  const active = await run($, 'run-state', ['active', '--json'], READ_MS)
  const slug = activeSlug(parse(active))
  let current = null
  let ledgerError = ''
  if (typeof slug === 'string') {
    const report = parse(await run($, 'ledger', ['report', slug, '--json'], READ_MS))
    if (report === undefined) ledgerError = 'the run report did not answer'
    else current = currentFigures(report)
  }
  const baselineAnswer = parse(await run($, 'ledger', ['baseline', '--before', GUARDS_SINCE, '--json'], READ_MS))
  const baseline = baselineFigures(baselineAnswer)
  return paneLines({ run: typeof slug === 'string' ? safeText(slug) : '', current, baseline, ledgerError, columns }) as Line[]
}

async function drawPane($: EngineInterface, e: RenderInput) {
  const flags = await readFlags($)
  if (isOff(flags)) return undefined
  const rows = await lines($, widthOf(e))
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <Text key={`line-${i}`} weight={r.bold ? 'bold' : undefined}>
          {r.text}
        </Text>
      ))}
    </Box>
  )
}

// The first open of the pane marks the discovery flag; it is sent once per session and only while the flag reads false.
async function markSeen($: EngineInterface, flags: Flags | undefined): Promise<void> {
  if (isSeenSent || flags === undefined || flags[SEEN_OWNER]?.seen !== false) return
  isSeenSent = true
  await run($, 'settings', ['set-mod', SEEN_OWNER, 'seen'], WRITE_MS)
}

async function openPane($: EngineInterface): Promise<{ text: string }> {
  const flags = await readFlags($)
  if (isOff(flags)) return { text: 'savings-pane is OFF. Turn it on in /aico-mods.' }
  await markSeen($, flags)
  try {
    await $.ui.open({ id: PANE, title: 'aico savings' })
  } catch {
    return { text: 'aico savings could not open a pane here.' }
  }
  return { text: 'aico savings opened.' }
}

export function registerSavings(on: On): void {
  // A match pattern of its own keeps this hook apart from the other mods' `session.start`.
  on('session.start', { cwd: /./ }, async ($, e, next) => {
    isSeenSent = false
    try {
      await $.command.register({ name: COMMAND, description: 'Show median tokens per task step against the fixed baseline' })
    } catch {
      // The command is a convenience; the pane works without it.
    }
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
