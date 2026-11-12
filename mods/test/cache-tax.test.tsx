import { expect, mock, test } from 'claude-code/testing'

import { cellWidth, fmtClock } from '../lib/format.mjs'

const START = Date.parse('2026-10-26T10:00:00Z')
const NOW = START + 12 * 60_000
const MIN = 60_000
const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')

const MODS = (tax: { enabled: boolean; pane: string }) => ({
  savvy: { enabled: false, pane: 'command' },
  cache_tax: tax,
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
})
const SETTINGS = (tax = { enabled: true, pane: 'command' }, roles: Record<string, { name: string }> = {}) =>
  JSON.stringify({
    revision: 1,
    roles: { 'backend-engineer': { name: 'Ben' }, 'frontend-engineer': { name: 'Freya' }, qa: { name: 'Quinn' }, ...roles },
    mods: MODS(tax),
  })

const view = {
  v: 1,
  slug: 'demo',
  state: 'running',
  started: STAMP(START),
  ended: null,
  outcome: null,
  wave: 2,
  gates: [],
  round: 0,
  tier: 'high',
  steps: [],
  warnings: [],
}
const ACTIVE = JSON.stringify({ slug: 'demo', view })
const NONE = JSON.stringify({ slug: null, view: null })

// Output of `ledger.mjs report demo --json --live` on a ledger with a reconciled Step, an unreconciled
// Step, a Reflect record and a live Step (captured from the script; the cache write of 06 is the tax).
const REPORT = {
  v: 1,
  run: 'demo',
  rows: [
    { kind: 'step', id: '05', role: 'backend-engineer', agent: 'aaa111', state: 'reconciled', tokens: { in: 15, cache_write: 120, cache_read: 2200, out: 110 }, spend: 245, ctx_end: 2445, ms: 1000, model: 'claude-sonnet-5-5' },
    { kind: 'step', id: '07', role: 'qa', agent: 'ccc333', state: 'unreconciled', tokens: null, spend: null, ctx_end: 1000, ms: null, model: null },
    { kind: 'reflect', id: 'RT', role: 'lead', agent: null, state: 'reconciled', tokens: { in: 10, cache_write: 20, cache_read: 30, out: 40 }, spend: 70, ctx_end: null, ms: null, model: null },
    { kind: 'step', id: '06', role: 'frontend-engineer', agent: 'bbb222', state: 'live', tokens: { in: 1234567, cache_write: 98765432, cache_read: 4400000, out: 3210 }, spend: 100003209, ctx_end: 1000, ms: 2000, model: 'claude-sonnet-5-5' },
  ],
  totals: { spend: 100003524, cache_read: 4402230, cache_write: 98765572, cache_write_share: 0.9876, by_kind: { reflect: 70, step: 100003454 } },
  per_ac: { spend: null, cache_read: null },
  not_reconciled: 1,
  warnings: [],
}
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout: `${stdout}\r\n`, stderr: '' } })

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Info = { id: string; description: string; type: string; status: string }

function makeWorld() {
  return {
    now: NOW,
    settings: SETTINGS(),
    active: ACTIVE as unknown,
    ledger: ok(JSON.stringify(REPORT)) as unknown,
    ledgerMtime: 1,
    // What `lead-handover.mjs ctx demo --json` answers; a measured 1 h keeps the lifetime assertions meaningful.
    ctx: ok(JSON.stringify({ v: 1, ctx: 42000, peak: 50000, at: '2026-10-26T10:05:00Z', ttl: '1h' })) as unknown,
    ctxMtime: 1,
    agents: [] as Info[],
    isPlaced: true,
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    ledgerCalls: [] as string[][],
    scripts: [] as string[],
    modelCalls: 0,
    writes: 0,
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], world: World, surface: 'terminal' | 'desktop' = 'terminal') {
  const clock = mock.clock(on, { now: world.now })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', ((_: unknown, e: { path: string }) => {
    const isCtx = String(e.path).replace(/\\/g, '/').endsWith('/lead-context.json')
    return { value: { kind: 'file', size: 10, mtimeMs: isCtx ? world.ctxMtime : world.ledgerMtime, isLink: false } }
  }) as never)
  on('agent.list', () => ({ value: world.agents }) as never)
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ((_: unknown, e: { id: string }) => {
    world.opened.push(e.id)
    return { value: { isPlaced: world.isPlaced } }
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
    if (script === 'lead-handover.mjs') return typeof world.ctx === 'function' ? world.ctx() : world.ctx
    if (script === 'ledger.mjs') {
      world.ledgerCalls.push(e.argv.slice(2))
      return typeof world.ledger === 'function' ? world.ledger() : world.ledger
    }
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(2500)
  return clock
}

// One request of the model on the main loop, or of a subagent when `agentId` is given.
async function request($: Env[0], agentId?: string) {
  const input = { turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) }
  for await (const chunk of $.turn.step(input as never)) void chunk
}

function pane(surface: 'terminal' | 'desktop', bodyColumns = 63) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: 'aico-cost',
    surface,
    props: { title: 'Cache Tax', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const
}

type Ui = Awaited<ReturnType<Env[0]['ui']['mount']>>
async function lines(ui: Ui) {
  const all = await ui.findAll({ type: 'Text' })
  return all.map(t => t.text ?? '')
}
const last = (w: World) => w.statuses[w.statuses.length - 1]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`one block per dispatch with exact counts, the cache write marked [tax], and the run total (${surface})`, async ($, on) => {
    const w = makeWorld()
    await boot($, on, w, surface)
    const ui = await $.ui.mount(pane(surface))
    const rows = await lines(ui)
    expect(w.ledgerCalls[0]).toEqual(['report', 'demo', '--json', '--live'])
    // Step 06 (live): every number equals the report.
    const at6 = rows.findIndex(r => r === '06 frontend-engineer (Freya)')
    expect(at6).toBeGreaterThan(-1)
    expect(rows.slice(at6 + 1, at6 + 6)).toEqual([
      'in          1234567',
      'write [tax] 98765432',
      'out         3210',
      'read        4400000',
      'spend       100003209',
    ])
    // Step 05 (reconciled)
    const at5 = rows.findIndex(r => r === '05 backend-engineer (Ben)')
    expect(rows.slice(at5 + 1, at5 + 6)).toEqual(['in          15', 'write [tax] 120', 'out         110', 'read        2200', 'spend       245'])
    // The Reflect record belongs to the Lead
    const atRt = rows.findIndex(r => r === 'RT lead')
    expect(rows.slice(atRt + 1, atRt + 6)).toEqual(['in          10', 'write [tax] 20', 'out         40', 'read        30', 'spend       70'])
    // Unreconciled: unknown in every cell
    const at7 = rows.findIndex(r => r === '07 qa (Quinn)')
    expect(rows.slice(at7 + 1, at7 + 6).every(r => r.endsWith('unknown'))).toBe(true)
    // Totals equal the report, then the share
    const total = rows.findIndex(r => r === 'Run total')
    expect(rows.slice(total + 1, total + 4)).toEqual(['spend       100003524', 'read        4402230', 'write [tax] 98765572'])
    expect(rows).toContain('cache write = 99% of spend [tax]')
    await ui.unmount()
  })
}

test('cache writes carry the [tax] marker as text and no colour', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await $.ui.mount(pane('terminal'))
  const all = await ui.findAll({ type: 'Text' })
  expect(all.filter(t => (t.text ?? '').includes('[tax]')).length).toBeGreaterThan(3)
  for (const t of all) expect((t.props as Record<string, unknown>).color).toBeUndefined()
  await ui.unmount()
})

test('the status part carries spend, tax share and the cache clock', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  expect(last(w)).toContain('98.8M tax ?')
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('98.8M tax 60m')
  expect(cellWidth(last(w) ?? '')).toBeLessThanOrEqual(46)
})

test('Lead cache: unknown until a main-loop request, then expires with the time and minutes left', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  let ui = await $.ui.mount(pane('terminal', 120))
  let rows = await lines(ui)
  expect(rows).toContain('Lead cache: unknown')
  expect(rows).toContain('Subagent caches last 5 minutes; nothing keeps them warm.')
  await ui.unmount()

  await request($)
  await clock.advance(18 * MIN)
  ui = await $.ui.mount(pane('terminal', 120))
  rows = await lines(ui)
  expect(rows.some(r => r.startsWith(`Lead cache: expires ${fmtClock(NOW + 2500 + 60 * MIN)} (in `))).toBe(true)
  expect(rows.join('\n')).toMatch(/\(in 4[0-3] min\)/)
  expect(rows).toContain('Lifetime: 1 h (measured)')
  expect(rows).toContain('Subagent caches last 5 minutes; nothing keeps them warm.')
  await ui.unmount()
})

test('session.start resets the lifetime and source to unknown', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('tax 60m')
  let ui = await $.ui.mount(pane('terminal', 120))
  expect(await lines(ui)).toContain('Lifetime: 1 h (measured)')
  await ui.unmount()

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  expect(last(w)).toContain('tax ?')
  ui = await $.ui.mount(pane('terminal', 120))
  const rows = await lines(ui)
  expect(rows).toContain('Lead cache: unknown')
  expect(rows.some(r => r.startsWith('Lifetime:') && r.includes('(measured)'))).toBe(false)
  await ui.unmount()
})

test('a request restarts the clock; a subagent request does not touch it', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(30 * MIN)
  await request($, 'a9')
  await clock.advance(2100)
  expect(last(w)).toMatch(/ (29|30)m$/)
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('tax 60m')
})

test('after 60 minutes the clock reads expired, in the pane and on the status line', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(61 * MIN)
  expect(last(w)).toContain('tax exp')
  const ui = await $.ui.mount(pane('terminal', 120))
  const rows = await lines(ui)
  expect(rows.some(r => r.startsWith(`Lead cache: expired ${fmtClock(NOW + 2500 + 60 * MIN)}; the next turn rewrites it`))).toBe(true)
  await ui.unmount()
})

test('a subagent with no ledger row yet shows running in every count cell', async ($, on) => {
  const w = makeWorld()
  w.agents = [{ id: 'a1', description: 'x', type: 'aico:frontend-engineer', status: 'running' }]
  await boot($, on, w)
  await $.agent.spawn({ subagentType: 'aico:frontend-engineer', prompt: 'Output: .company/work/demo/09-frontend-engineer.md\n' })
  const ui = await $.ui.mount(pane('terminal'))
  const rows = await lines(ui)
  const at = rows.findIndex(r => r === '09 frontend-engineer (Freya)')
  expect(at).toBeGreaterThan(-1)
  expect(rows.slice(at + 1, at + 6).every(r => r.endsWith('running'))).toBe(true)
  await ui.unmount()
})

test('a Name: line in a prompt is ignored; no map entry shows no name', async ($, on) => {
  const w = makeWorld()
  w.agents = [{ id: 'a1', description: 'x', type: 'aico:frontend-engineer', status: 'running' }]
  await boot($, on, w)
  await $.agent.spawn({ subagentType: 'aico:frontend-engineer', prompt: 'Name: Mallory\nOutput: .company/work/demo/09-frontend-engineer.md\n' })
  const ui = await $.ui.mount(pane('terminal'))
  const rows = await lines(ui)
  expect(rows).toContain('09 frontend-engineer (Freya)')
  expect(rows.join('\n')).not.toContain('Mallory')
  await ui.unmount()
})

test('a subagent that already has a ledger row is not shown twice', async ($, on) => {
  const w = makeWorld()
  w.agents = [{ id: 'aaa111', description: 'x', type: 'aico:backend-engineer', status: 'running' }]
  await boot($, on, w)
  const ui = await $.ui.mount(pane('terminal'))
  expect((await lines(ui)).filter(r => r.endsWith('running'))).toEqual([])
  await ui.unmount()
})

// No row is wider than the pane body: 39 is the narrowest docked pane.
for (const width of [39, 63, 89]) {
  test(`no row is wider than ${width} cells, with wide Role names and every state`, async ($, on) => {
    const w = makeWorld()
    w.settings = SETTINGS({ enabled: true, pane: 'command' }, { 'backend-engineer': { name: '漢字'.repeat(18) } })
    w.agents = [{ id: 'zzz999', description: 'x', type: 'aico:frontend-engineer', status: 'running' }]
    const clock = await boot($, on, w)
    await request($)
    await clock.advance(61 * MIN)
    const ui = await $.ui.mount(pane('terminal', width))
    const all = await lines(ui)
    expect(all.length).toBeGreaterThan(20)
    for (const row of all) expect(cellWidth(row)).toBeLessThanOrEqual(width)
    // numbers are never cut: the largest value still shows whole
    expect(all).toContain('write [tax] 98765432')
    expect(all.join(' ')).toContain('Lead cache: expired')
    await ui.unmount()
  })
}

test('the cache clock needs no run; without a run the cost says so and the status stays empty', async ($, on) => {
  const w = makeWorld()
  w.active = NONE
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(2100)
  expect(w.ledgerCalls).toEqual([])
  expect(w.statuses.filter(s => s !== undefined && s.includes('spend'))).toEqual([])
  const ui = await $.ui.mount(pane('terminal', 90))
  const rows = await lines(ui)
  expect(rows).toContain('No aico run is active.')
  expect(rows.some(r => r.startsWith('Lead cache: expires'))).toBe(true)
  await ui.unmount()
  const out = await $.command.run({ command: 'aico-cost', args: '' } as never)
  expect(JSON.stringify(out)).toContain('No aico run is active')
})

test('pane command never opens unasked, the command opens it; auto opens when a run is active', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  expect(w.opened).not.toContain('aico-cost')
  const out = await $.command.run({ command: 'aico-cost', args: '' } as never)
  expect(JSON.stringify(out)).not.toContain('is off')
  expect(w.opened).toContain('aico-cost')
})

test('pane auto opens the pane unasked', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ enabled: true, pane: 'auto' })
  await boot($, on, w)
  expect(w.opened).toContain('aico-cost')
})

test('below 110 columns the pane is not placed and the status line holds the summary', async ($, on) => {
  const w = makeWorld()
  w.isPlaced = false
  w.settings = SETTINGS({ enabled: true, pane: 'auto' })
  await boot($, on, w)
  expect(w.opened).toContain('aico-cost')
  expect(last(w)).toContain('98.8M tax ?')
})

test('the ledger is read again when its file changes, and not while nothing changed', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  const before = w.ledgerCalls.length
  await clock.advance(4000)
  expect(w.ledgerCalls.length).toBe(before)
  w.ledger = ok(JSON.stringify({ ...REPORT, totals: { ...REPORT.totals, spend: 5, cache_write: 1, cache_write_share: 0.2 } }))
  w.ledgerMtime = 2
  await clock.advance(4000)
  expect(w.ledgerCalls.length).toBe(before + 1)
  expect(last(w)).toContain('1 tax')
})

// Hostile and broken answers show unknown and still draw.
const BREAKS: [string, () => unknown][] = [
  ['bad JSON', () => ok('{bad')],
  ['exit code 2', () => ({ value: { exitCode: 2, stdout: JSON.stringify(REPORT), stderr: '' } })],
  ['over-size output', () => ok('x'.repeat(300_000))],
  ['a negative count', () => ok(JSON.stringify({ ...REPORT, totals: { ...REPORT.totals, spend: -1 } }))],
  ['a fractional count', () => ok(JSON.stringify({ ...REPORT, rows: [{ ...REPORT.rows[0], tokens: { in: 1.5, cache_write: 1, cache_read: 1, out: 1 } }] }))],
  ['a row state outside the list', () => ok(JSON.stringify({ ...REPORT, rows: [{ ...REPORT.rows[0], state: 'sudo' }] }))],
  ['a rejection', () => ({ deny: 'no process here' })],
]
for (const [name, answer] of BREAKS) {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${name} shows unknown and still draws (${surface})`, async ($, on) => {
      const w = makeWorld()
      w.ledger = answer
      const clock = await boot($, on, w, surface)
      await request($)
      await clock.advance(2100)
      const ui = await $.ui.mount(pane(surface, 39))
      const all = await lines(ui)
      expect(all).toContain('Cost: unknown')
      expect(all.some(r => r.startsWith('Lead cache: expires'))).toBe(true)
      for (const row of all) expect(cellWidth(row)).toBeLessThanOrEqual(39)
      await ui.unmount()
      expect(last(w)).toContain('? tax')
    })
  }
}

test('a script that never answers times out and the cost shows unknown', async ($, on) => {
  const w = makeWorld()
  w.ledger = () => new Promise(() => undefined)
  const clock = await boot($, on, w)
  await clock.advance(8000)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await lines(ui)).toContain('Cost: unknown')
  await ui.unmount()
})

test('hostile ledger text is cleaned and cut: control characters, a __proto__ key, a long role', async ($, on) => {
  const w = makeWorld()
  const rows = [
    { ...REPORT.rows[0], role: 'backend-engineer', model: 'x\u001b[31m' + 'z'.repeat(5000) },
    { ...REPORT.rows[0], id: '06', role: 'a\u001b[31m‮'.repeat(60) },
  ]
  w.ledger = ok(`{"__proto__":{"polluted":true},${JSON.stringify({ ...REPORT, rows }).slice(1)}`)
  await boot($, on, w)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  const ui = await $.ui.mount(pane('terminal', 39))
  const all = await lines(ui)
  expect(all.length).toBeGreaterThan(5)
  for (const row of all) {
    expect(row).not.toMatch(/[\u0000-\u001f\u007f‮]/)
    expect(cellWidth(row)).toBeLessThanOrEqual(39)
  }
  await ui.unmount()
})

test('control characters in a Role name do not reach the pane', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ enabled: true, pane: 'command' }, { 'backend-engineer': { name: 'Ben\u001b[31m‮x' } })
  await boot($, on, w)
  const ui = await $.ui.mount(pane('terminal', 39))
  for (const row of await lines(ui)) expect(row).not.toMatch(/[\u0000-\u001f\u007f‮]/)
  await ui.unmount()
})

test('a mod that is off draws nothing, runs no script, sets no status and keeps no clock', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ enabled: false, pane: 'auto' })
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(30_000)
  expect(w.ledgerCalls).toEqual([])
  expect(w.opened).not.toContain('aico-cost')
  expect(w.statuses.filter(s => s !== undefined && s.includes('spend'))).toEqual([])
  const ui = await $.ui.mount(pane('terminal'))
  expect(await lines(ui)).toEqual([])
  await ui.unmount()
  const out = await $.command.run({ command: 'aico-cost', args: '' } as never)
  expect(JSON.stringify(out)).toContain('cache tax is off; switch it on in /aico:settings')
})

test('Cache Tax makes no model call, writes no file and writes nothing to the ledger', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(70 * MIN)
  const ui = await $.ui.mount(pane('terminal'))
  await lines(ui)
  await ui.unmount()
  await $.command.run({ command: 'aico-cost', args: '' } as never)
  expect(w.modelCalls).toBe(0)
  expect(w.writes).toBe(0)
  expect(w.ledgerCalls.length).toBeGreaterThan(0)
  for (const argv of w.ledgerCalls) expect(argv[0]).toBe('report')
  expect(w.scripts.every(s => ['settings.mjs', 'run-state.mjs', 'ledger.mjs', 'lead-handover.mjs'].includes(s))).toBe(true)
})

test('vscode and mobile pass the render through', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...pane('terminal'), surface } as never)
    expect(await lines(ui)).toEqual([])
    await ui.unmount()
  }
})
