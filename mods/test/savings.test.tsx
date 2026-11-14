import { expect, mock, test } from 'claude-code/testing'

import { GUARDS_SINCE } from '../lib/savings.mjs'

// T28 (QA-first, red until T29): the Savings pane, mods/savings.tsx. Pane `aico-savings`, command `aico-savings`.
// AC24 as amended (14-product-manager.md); wireframes in design/terminal-panes.md section 5. aico-mods v2.2.
const NOW = Date.parse('2026-11-14T10:00:00Z')
const PANE = 'aico-savings'

const SETTINGS = (enabled = true) =>
  JSON.stringify({
    revision: 1,
    roles: {},
    mods: { savvy: { enabled: false, pane: 'command' }, cache_tax: { enabled: true, pane: 'command' }, savings: { enabled } },
  })
const view = { v: 1, slug: 'demo', state: 'running', started: '2026-11-14T09:00:00Z', ended: null, outcome: null, wave: 1, gates: [], round: 0, tier: 'high', steps: [], warnings: [] }
const ACTIVE = JSON.stringify({ slug: 'demo', view })
const NONE = JSON.stringify({ slug: null, view: null })

const T = (n: number) => ({ in: n, cache_write: 0, cache_read: 0, out: 0 })
const step = (id: string, tokens: unknown) => ({ kind: 'step', id, role: 'qa', agent: `a${id}`, state: tokens === null ? 'unreconciled' : 'reconciled', tokens, spend: null, ctx_end: 1, ms: 1, model: 'm' })
const REPORT = (rows: unknown[], run = 'demo') => ({ v: 1, run, rows, totals: {}, per_ac: {}, not_reconciled: 0, warnings: [] })
const BASE_OK = (median = 51000, runs = 10) => ({ state: 'ok', median, runs, steps: 40, unknown: 0 })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout: `${stdout}\r\n`, stderr: '' } })

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }

function makeWorld() {
  return {
    settings: SETTINGS(),
    active: ACTIVE as unknown,
    report: ok(JSON.stringify(REPORT([step('01', T(48000)), step('02', T(48200)), step('03', T(49000))]))) as unknown,
    base: ok(JSON.stringify(BASE_OK())) as unknown,
    opened: [] as string[],
    ledgerCalls: [] as string[][],
    scripts: [] as string[],
    modelCalls: 0,
    writes: 0,
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], world: World) {
  const clock = mock.clock(on, { now: NOW })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', (() => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } })) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', ((_: unknown, e: { id: string }) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.run', () => ({ text: 'engine' }))
  on('agent.spawn', (() => ({ model: 'm', agentId: 'a1' })) as never)
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  } as never)
  on('model.complete', (() => {
    world.modelCalls++
    return { deny: 'no model' }
  }) as never)
  on('fs.write', (() => {
    world.writes++
    return { deny: 'no write' }
  }) as never)
  on('process.run', ((_: unknown, e: Call) => {
    const script = e.argv[1].replace(/\\/g, '/').split('/').pop() ?? ''
    world.scripts.push(script)
    if (script === 'settings.mjs') return ok(world.settings)
    if (script === 'run-state.mjs') return typeof world.active === 'function' ? world.active() : ok(world.active as string)
    if (script === 'ledger.mjs') {
      const args = e.argv.slice(2)
      world.ledgerCalls.push(args)
      const src = args[0] === 'baseline' ? world.base : world.report
      return typeof src === 'function' ? src() : src
    }
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  return clock
}

function pane(bodyColumns = 80) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: PANE,
    surface: 'terminal',
    props: { title: 'aico savings', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const
}

type Ui = Awaited<ReturnType<Env[0]['ui']['mount']>>
async function lines(ui: Ui) {
  const all = await ui.findAll({ type: 'Text' })
  return all.map(t => t.text ?? '')
}
async function show($: Env[0], on: Env[1], w: World, cols = 80) {
  await boot($, on, w)
  const ui = await $.ui.mount(pane(cols))
  const rows = await lines(ui)
  return { ui, rows, text: rows.join('\n') }
}
const row = (rows: string[], label: string) => rows.find(r => r.replace(/\s+/g, ' ').startsWith(label))?.replace(/\s+/g, ' ')

test('AC24: shows the median real tokens per Step and the fixed baseline, with counts', async ($, on) => {
  const w = makeWorld()
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step 48200')
  expect(row(rows, 'steps counted')).toBe('steps counted 3 of 3')
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) 51000')
  expect(row(rows, 'baseline runs')).toBe('baseline runs 10')
  expect(text).toContain('MEASURED')
  expect(text).not.toMatch(/NaN|Infinity|undefined|null/)
})

test('AC24: reads the report of the active run and the baseline before GUARDS_SINCE, read only', async ($, on) => {
  const w = makeWorld()
  await show($, on, w)
  const report = w.ledgerCalls.find(a => a[0] === 'report')
  expect(report).toEqual(['report', 'demo', '--json'])
  expect(w.ledgerCalls.find(a => a[0] === 'baseline')).toEqual(['baseline', '--before', GUARDS_SINCE, '--json'])
  expect(w.modelCalls).toBe(0)
  expect(w.writes).toBe(0)
  expect(w.scripts.every(s => ['settings.mjs', 'run-state.mjs', 'ledger.mjs'].includes(s))).toBe(true)
})

test('AC24: empty ledger shows NO DATA on both rows and the plain sentence', async ($, on) => {
  const w = makeWorld()
  w.report = ok(JSON.stringify(REPORT([])))
  w.base = ok(JSON.stringify({ state: 'no-data', median: null, runs: 0, steps: 0, unknown: 0 }))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step NO DATA')
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) NO DATA')
  expect(text).toContain('The ledger has no steps yet. Run a step, then reopen.')
  expect(text).not.toMatch(/NaN|\b0\b.*per step/)
})

test('AC24: no token field on any Step shows UNMEASURED, baseline row unaffected', async ($, on) => {
  const w = makeWorld()
  w.report = ok(JSON.stringify(REPORT([step('01', null), step('02', null)])))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step UNMEASURED')
  expect(text).toContain('Steps have no token counts recorded.')
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) 51000')
})

test('AC24: partial rows show the median over counted Steps and the unmeasured count, no zero-fill', async ($, on) => {
  const w = makeWorld()
  w.report = ok(JSON.stringify(REPORT([step('01', T(100)), step('02', null), step('03', T(300))])))
  const { rows } = await show($, on, w)
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step 200')
  expect(row(rows, 'steps counted')).toBe('steps counted 2 of 3 (1 unmeasured)')
})

test('AC24: 1-9 baseline runs show the count; the label never says "last 10 runs"', async ($, on) => {
  const w = makeWorld()
  w.base = ok(JSON.stringify(BASE_OK(51000, 6)))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) 51000')
  expect(row(rows, 'baseline runs')).toBe('baseline runs 6')
  expect(text).not.toMatch(/last 10 runs/i)
})

test('AC24: baseline with no pre-guard run shows NO DATA and its sentence', async ($, on) => {
  const w = makeWorld()
  w.base = ok(JSON.stringify({ state: 'no-data', median: null, runs: 0, steps: 0, unknown: 0 }))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) NO DATA')
  expect(text).toContain('No runs from before guards are in the ledger.')
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step 48200')
})

test('AC24: baseline runs without token counts show UNMEASURED', async ($, on) => {
  const w = makeWorld()
  w.base = ok(JSON.stringify({ state: 'unmeasured', median: null, runs: 3, steps: 0, unknown: 0 }))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) UNMEASURED')
  expect(text).toContain('Runs from before guards have no token counts.')
})

test('AC24: runs with no meta line at all show UNKNOWN, never a number', async ($, on) => {
  const w = makeWorld()
  w.base = ok(JSON.stringify({ state: 'unknown', median: null, runs: 0, steps: 0, unknown: 4 }))
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) UNKNOWN')
  expect(text).toContain('The ledger does not mark when guards started.')
})

test('AC24: no verdict word, no percentage of tokens saved in the measured block', async ($, on) => {
  const w = makeWorld()
  w.report = ok(JSON.stringify(REPORT([step('01', T(10))])))
  const { text } = await show($, on, w)
  expect(text).not.toMatch(/saved|savings of|\d\s?%\s+(fewer|less|lower)/i)
  expect(text.split('ESTIMATED')[0]).not.toContain('%')
})

test('AC24: the estimate sits in its own labelled block; none when no saver reports one', async ($, on) => {
  const w = makeWorld()
  const { rows } = await show($, on, w)
  const at = rows.findIndex(r => r.trim() === 'ESTIMATED (not measured)')
  expect(at).toBeGreaterThan(rows.findIndex(r => r.trim().startsWith('MEASURED')))
  expect(rows[at + 1].trim()).toBe('none, no saver reports an estimate')
})

test('AC24: an unreadable ledger shows one sentence and hides both rows', async ($, on) => {
  const w = makeWorld()
  w.report = { value: { exitCode: 2, stdout: '', stderr: 'boom' } }
  const { text } = await show($, on, w)
  expect(text).toContain('aico savings cannot read the ledger:')
  expect(text).toContain('Nothing is shown rather than a wrong number.')
  expect(text).not.toContain('median tokens per step')
  expect(text).not.toContain('baseline (before guards)')
})

test('AC24: a garbled baseline answer never shows a number or NaN for the baseline', async ($, on) => {
  const w = makeWorld()
  w.base = ok('{"state":"ok","median":"NaN","runs":99}')
  const { rows, text } = await show($, on, w)
  expect(row(rows, 'baseline (before guards)')).not.toMatch(/\d{2,}/)
  expect(text).not.toMatch(/NaN/)
})

test('AC24: hostile text in a run name or role is rendered inert and truncated', async ($, on) => {
  const w = makeWorld()
  const evil = `x\x1b[31m<b>${'y'.repeat(100)}\x07`
  w.active = ok(JSON.stringify({ slug: evil, view: { ...view, slug: evil } }))
  w.report = ok(JSON.stringify(REPORT([{ ...step('01', T(10)), role: evil, agent: evil }], evil)))
  const { rows } = await show($, on, w)
  for (const r of rows) {
    expect(r).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
    expect(r).not.toContain('\x1b')
    expect(r.length).toBeLessThan(200)
  }
})

test('AC24: no active run shows NO DATA for the median and still reads the baseline', async ($, on) => {
  const w = makeWorld()
  w.active = ok(NONE)
  const { rows } = await show($, on, w)
  expect(row(rows, 'median tokens per step')).toBe('median tokens per step NO DATA')
  expect(row(rows, 'baseline (before guards)')).toBe('baseline (before guards) 51000')
})

test('AC24: narrow width (under 80 cols) puts the value on the line after its label', async ($, on) => {
  const w = makeWorld()
  const { rows } = await show($, on, w, 50)
  const at = rows.findIndex(r => r.trim() === 'median tokens per step')
  expect(at).toBeGreaterThan(-1)
  expect(rows[at + 1].trim()).toBe('48200')
})

test('AC25: the command opens the pane when savings is on; off prints one line and does not open', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  await $.command.run({ command: 'aico-savings', args: '' } as never)
  expect(w.opened).toContain(PANE)

  const off = makeWorld()
  off.settings = SETTINGS(false)
  await boot($, on, off)
  const out = await $.command.run({ command: 'aico-savings', args: '' } as never)
  expect(JSON.stringify(out)).toContain('savings-pane is OFF. Turn it on in /aico-mods.')
  expect(off.opened).not.toContain(PANE)
})

test('AC24: never calls a model or writes a file, in any state', async ($, on) => {
  const w = makeWorld()
  w.report = ok('not json')
  await show($, on, w)
  expect(w.modelCalls).toBe(0)
  expect(w.writes).toBe(0)
})
