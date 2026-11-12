import { expect, mock, test } from 'claude-code/testing'

import { fmtClock } from '../lib/format.mjs'

const START = Date.parse('2026-10-26T10:00:00Z')
const NOW = START + 12 * 60_000
const MIN = 60_000
const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
// The first main-loop request after `boot` happens 2500 ms after NOW.
const REQUEST_AT = NOW + 2500

const SETTINGS = JSON.stringify({
  revision: 1,
  roles: { qa: { name: 'Quinn' } },
  mods: {
    savvy: { enabled: false, pane: 'command' },
    cache_tax: { enabled: true, pane: 'command' },
    reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
    blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
  },
})
const view = { v: 1, slug: 'demo', state: 'running', started: STAMP(START), ended: null, outcome: null, wave: 2, gates: [], round: 0, tier: 'high', steps: [], warnings: [] }
const ACTIVE = JSON.stringify({ slug: 'demo', view })
const NONE = JSON.stringify({ slug: null, view: null })
const REPORT = {
  v: 1,
  run: 'demo',
  rows: [{ kind: 'step', id: '05', role: 'qa', agent: 'aaa111', state: 'reconciled', tokens: { in: 15, cache_write: 120, cache_read: 2200, out: 110 }, spend: 245, ctx_end: 2445, ms: 1000, model: 'claude-sonnet-5-5' }],
  totals: { spend: 245, cache_read: 2200, cache_write: 120, cache_write_share: 0.49, by_kind: { step: 245 } },
  per_ac: { spend: null, cache_read: null },
  not_reconciled: 0,
  warnings: [],
}
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout: `${stdout}\r\n`, stderr: '' } })
const ctxAnswer = (ttl: unknown, withKey = true) => JSON.stringify({ v: 1, ctx: 42000, peak: 50000, at: '2026-10-26T10:05:00Z', ...(withKey ? { ttl } : {}) })

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[] }

function makeWorld() {
  return {
    now: NOW,
    active: ACTIVE,
    // What `lead-handover.mjs ctx demo --json` answers: a stdout text, or a function for a failure.
    ctx: ok(ctxAnswer('1h')) as unknown,
    ctxMtime: 1,
    statuses: [] as (string | undefined)[],
    scripts: [] as string[],
    ctxCalls: [] as string[][],
    modelCalls: 0,
    writes: 0,
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], world: World) {
  const clock = mock.clock(on, { now: world.now })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', ((_: unknown, e: { path: string }) => {
    const isCtx = String(e.path).replace(/\\/g, '/').endsWith('/lead-context.json')
    return { value: { kind: 'file', size: 10, mtimeMs: isCtx ? world.ctxMtime : 1, isLink: false } }
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (() => ({ value: { isPlaced: true } })) as never)
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
    if (script === 'settings.mjs') return ok(SETTINGS)
    if (script === 'run-state.mjs') return ok(world.active as string)
    if (script === 'ledger.mjs') return ok(JSON.stringify(REPORT))
    if (script === 'lead-handover.mjs') {
      world.ctxCalls.push(e.argv.slice(2))
      return typeof world.ctx === 'function' ? world.ctx() : world.ctx
    }
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  return clock
}

async function request($: Env[0]) {
  const input = { turnId: 't1', index: 0, model: 'm', messageCount: 1 }
  for await (const chunk of $.turn.step(input as never)) void chunk
}

function pane(bodyColumns = 120) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: 'aico-cost',
    surface: 'terminal',
    props: { title: 'Cache Tax', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const
}

async function paneLines($: Env[0]) {
  const ui = await $.ui.mount(pane())
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return all.map(t => t.text ?? '')
}
const last = (w: World) => w.statuses[w.statuses.length - 1] ?? ''

// ---- AC4

test('AC4 a 5 minute reading: status 5m at the request, exp five minutes later', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('5m'))
  const clock = await boot($, on, w)
  expect(w.ctxCalls[0]).toEqual(['ctx', 'demo', '--json'])
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('tax 5m')
  await clock.advance(5 * MIN)
  expect(last(w)).toContain('tax exp')
})

test('AC4 a 5 minute reading: the pane shows the expiry at the request plus 5 min and Lifetime: 5 min (measured)', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('5m'))
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(2100)
  let rows = await paneLines($)
  expect(rows.some(r => r.startsWith(`Lead cache: expires ${fmtClock(REQUEST_AT + 5 * MIN)} (in `))).toBe(true)
  expect(rows).toContain('Lifetime: 5 min (measured)')
  expect(rows).toContain('Subagent caches last 5 minutes; nothing keeps them warm.')
  await clock.advance(5 * MIN)
  rows = await paneLines($)
  expect(rows.some(r => r.startsWith(`Lead cache: expired ${fmtClock(REQUEST_AT + 5 * MIN)}; the next turn rewrites it`))).toBe(true)
  expect(rows).toContain('Lifetime: 5 min (measured)')
})

test('AC4 a reading that arrives after the request applies to that request at once', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer(null))
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('tax 60m')
  w.ctx = ok(ctxAnswer('5m'))
  w.ctxMtime = 2
  await clock.advance(2100)
  expect(last(w)).toMatch(/tax [45]m$/)
  expect(await paneLines($)).toContain('Lifetime: 5 min (measured)')
})

test('AC4 the reading persists across requests, with no new call', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('5m'))
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(3 * MIN)
  await request($)
  await clock.advance(2100)
  expect(last(w)).toContain('tax 5m')
  expect(await paneLines($)).toContain('Lifetime: 5 min (measured)')
  expect(w.ctxCalls.length).toBe(1)
})

// ---- AC5

test('AC5 a 1h reading gives the same pane lines and status as before the change', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('1h'))
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(18 * MIN)
  const rows = await paneLines($)
  expect(rows.some(r => r.startsWith(`Lead cache: expires ${fmtClock(REQUEST_AT + 60 * MIN)} (in `))).toBe(true)
  expect(rows.join('\n')).toMatch(/\(in 4[0-3] min\)/)
  expect(rows).toContain('Lifetime: 1 h (measured)')
  expect(rows).toContain('Subagent caches last 5 minutes; nothing keeps them warm.')
  expect(last(w)).toMatch(/tax 4[0-3]m$/)
  await clock.advance(43 * MIN)
  expect(last(w)).toContain('tax exp')
})

// ---- AC6: hostile readings, then every way the reading can be missing

const HOSTILE: [string, unknown][] = [
  ['null', null],
  ['5M', '5M'],
  ['a leading space', ' 5m'],
  ['a trailing bidi override', '5m‮'],
  ['a zero-width space', '5m​'],
  ['a number', 300000],
  ['an object', { ttl: '5m' }],
  ['an array', ['5m']],
  ['__proto__', '__proto__'],
  ['constructor', 'constructor'],
  ['an unknown word', '2h'],
  ['a very long string', 'x'.repeat(100000)],
]

for (const [name, raw] of HOSTILE) {
  test(`AC6 ttl ${name}: 60 min, 1 h (assumed), no throw, the raw value is never shown`, async ($, on) => {
    const w = makeWorld()
    w.ctx = ok(ctxAnswer(raw))
    const clock = await boot($, on, w)
    await request($)
    await clock.advance(18 * MIN)
    const rows = await paneLines($)
    expect(rows).toContain('Lifetime: 1 h (assumed)')
    expect(rows.some(r => r.startsWith(`Lead cache: expires ${fmtClock(REQUEST_AT + 60 * MIN)} (in `))).toBe(true)
    expect(last(w)).toMatch(/tax 4[0-3]m$/)
    if (typeof raw === 'string' && raw.length > 0) {
      for (const text of [...rows, ...w.statuses.map(s => s ?? '')]) expect(text.includes(raw)).toBe(false)
    }
    expect(w.modelCalls).toBe(0)
    expect(w.writes).toBe(0)
  })
}

const FAILURES: [string, (w: World) => void][] = [
  ['a missing ttl key', w => { w.ctx = ok(ctxAnswer(undefined, false)) }],
  ['non-JSON output', w => { w.ctx = ok('not json at all') }],
  ['empty output', w => { w.ctx = ok('') }],
  ['exit code 1', w => { w.ctx = { value: { exitCode: 1, stdout: '', stderr: 'boom' } } }],
  ['a call that throws', w => { w.ctx = () => { throw new Error('spawn failed') } }],
  ['a call that is denied', w => { w.ctx = () => ({ deny: 'no process' }) }],
]

for (const [name, setup] of FAILURES) {
  test(`AC6 ${name}: 60 min, 1 h (assumed), the request is never held`, async ($, on) => {
    const w = makeWorld()
    setup(w)
    const clock = await boot($, on, w)
    await request($)
    await clock.advance(18 * MIN)
    const rows = await paneLines($)
    expect(rows).toContain('Lifetime: 1 h (assumed)')
    expect(last(w)).toMatch(/tax 4[0-3]m$/)
    expect(w.modelCalls).toBe(0)
  })
}

test('AC6 a failed call after a good reading keeps the earlier reading', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('5m'))
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(2100)
  w.ctx = ok('not json at all')
  w.ctxMtime = 2
  await clock.advance(2100)
  expect(await paneLines($)).toContain('Lifetime: 5 min (measured)')
})

test('AC6 no active run: no ctx call, 60 min, 1 h (assumed)', async ($, on) => {
  const w = makeWorld()
  w.active = NONE
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(30_000)
  expect(w.ctxCalls.length).toBe(0)
  expect(w.scripts.includes('lead-handover.mjs')).toBe(false)
  const rows = await paneLines($)
  expect(rows).toContain('Lifetime: 1 h (assumed)')
  expect(rows.some(r => r.startsWith(`Lead cache: expires ${fmtClock(REQUEST_AT + 60 * MIN)} (in `))).toBe(true)
})

test('AC6 a slow ctx call does not hold the request', async ($, on) => {
  const w = makeWorld()
  w.ctx = () => new Promise(() => undefined)
  const clock = await boot($, on, w)
  await request($)
  await clock.advance(18 * MIN)
  expect(last(w)).toMatch(/tax 4[0-3]m$/)
  expect(await paneLines($)).toContain('Lifetime: 1 h (assumed)')
})

// ---- call budget

test('no ctx call without a change of the lead-context.json modification time', async ($, on) => {
  const w = makeWorld()
  w.ctx = ok(ctxAnswer('5m'))
  const clock = await boot($, on, w)
  const first = w.ctxCalls.length
  expect(first).toBe(1)
  await request($)
  await clock.advance(60_000)
  await request($)
  await clock.advance(60_000)
  expect(w.ctxCalls.length).toBe(first)
  w.ctxMtime = 2
  await clock.advance(2100)
  expect(w.ctxCalls.length).toBe(first + 1)
  expect(w.ctxCalls[first]).toEqual(['ctx', 'demo', '--json'])
  await clock.advance(30_000)
  expect(w.ctxCalls.length).toBe(first + 1)
})

test('a request never calls a script by itself', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  const before = w.scripts.length
  await request($)
  expect(w.scripts.length).toBe(before)
  await clock.advance(1)
})
