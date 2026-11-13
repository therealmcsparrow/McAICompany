import { expect, mock, test } from 'claude-code/testing'

import { cellWidth } from '../lib/format.mjs'

const START = Date.parse('2026-10-26T10:00:00Z')
const NOW = START + 12 * 60_000
const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')

type Mods = { savvy: boolean; tax: boolean; pane?: string }
const SETTINGS = ({ savvy, tax, pane = 'command' }: Mods) =>
  JSON.stringify({
    revision: 1,
    roles: {},
    mods: {
      savvy: { enabled: savvy, pane },
      cache_tax: { enabled: tax, pane },
      reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
    },
  })

const view = (slug: string) => ({
  v: 1, slug, state: 'running', started: STAMP(START), ended: null, outcome: null, wave: 2, gates: [], round: 0, tier: 'high', steps: [], warnings: [],
})
const REPORT = (spend: number) => ({
  v: 1,
  run: 'demo',
  rows: [{ kind: 'step', id: '06', role: 'frontend-engineer', agent: 'bbb222', state: 'live', tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 }, spend, ctx_end: 1, ms: 1, model: 'm' }],
  totals: { spend, cache_read: 3, cache_write: 2, cache_write_share: 0.5, by_kind: { step: spend } },
  per_ac: { spend: null, cache_read: null },
  not_reconciled: 0,
  warnings: [],
})
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })

type Env = Parameters<Parameters<typeof test>[1]>

function makeWorld() {
  return {
    settings: SETTINGS({ savvy: true, tax: true }),
    slug: 'demo',
    spend: 100003524,
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    isPlaced: true,
    failStatus: 0,
    statusCalls: 0,
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], w: World, surface: 'terminal' | 'desktop' = 'terminal') {
  const clock = mock.clock(on, { now: NOW })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', ((_: unknown, e: { text: string | undefined }) => {
    w.statusCalls++
    if (w.failStatus > 0) {
      w.failStatus--
      return { deny: 'status refused' }
    }
    w.statuses.push(e.text)
    return { value: undefined }
  }) as never)
  on('ui.open', ((_: unknown, e: { id: string }) => {
    w.opened.push(e.id)
    return { value: { isPlaced: w.isPlaced } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => e as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.run', () => ({ text: 'engine' }))
  on('agent.spawn', (() => ({ model: 'm', agentId: 'a1' })) as never)
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  } as never)
  on('process.run', ((_: unknown, e: { argv: string[] }) => {
    const script = e.argv[1].replace(/\\/g, '/').split('/').pop() ?? ''
    if (script === 'settings.mjs') return ok(w.settings)
    if (script === 'run-state.mjs') return ok(JSON.stringify({ slug: w.slug, view: view(w.slug) }))
    if (script === 'ledger.mjs') return ok(JSON.stringify(REPORT(w.spend)))
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(2500)
  return clock
}

const last = (w: World) => w.statuses[w.statuses.length - 1]
const commit = ($: Env[0]) => $.tool.check({ tool: 'Bash', input: { command: 'git commit -m x' } } as never)
const SAVVY = 'W\\d+ S[\\d?]+ ([a-z-]+ )?\\d+m'
const COST = '[\\d.]+[kMG]? tax (\\d+m|exp|\\?)'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Savvy and Cache Tax share one line in order for 60 seconds (${surface})`, async ($, on) => {
    const w = makeWorld()
    const clock = await boot($, on, w, surface)
    const first = w.statuses.findIndex(s => s !== undefined && s.includes(' tax '))
    expect(first).toBeGreaterThan(-1)
    for (let i = 0; i < 30; i++) await clock.advance(2000)
    const shape = new RegExp(`^${SAVVY} · ${COST}$`)
    for (const line of w.statuses.slice(first)) expect(line).toMatch(shape)
  })
}

test('a git commit adds no status part and leaves the line as it was', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  const before = last(w)
  const r = await commit($)
  expect(r.decision).toBe('allow')
  await clock.advance(0)
  expect(last(w)).toBe(before)
  expect(last(w)).toMatch(new RegExp(`^${SAVVY} · ${COST}$`))
  await clock.advance(60_000)
  expect(last(w)).toMatch(new RegExp(`^${SAVVY} · ${COST}$`))
  expect(w.statuses.some(s => s !== undefined && s.includes('⚠'))).toBe(false)
  expect(w.statuses.includes(undefined)).toBe(false)
})

test('Cache Tax off leaves only the Savvy part, then the reverse', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  w.settings = SETTINGS({ savvy: true, tax: false })
  await $.turn.start({ turnId: 't2', model: 'm', messageCount: 1 } as never)
  await clock.advance(4100)
  expect(last(w)).toMatch(new RegExp(`^${SAVVY}$`))
  w.settings = SETTINGS({ savvy: false, tax: true })
  await $.turn.start({ turnId: 't3', model: 'm', messageCount: 1 } as never)
  await clock.advance(100)
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) void chunk
  await clock.advance(4100)
  expect(last(w)).toMatch(new RegExp(`^aico idle · ${COST}$`))
})

test('with Savvy off and no placed pane the Cache Tax summary stands alone on the line', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ savvy: false, tax: true, pane: 'auto' })
  w.isPlaced = false
  await boot($, on, w)
  expect(w.opened).toContain('aico-cost')
  expect(last(w)).toMatch(new RegExp(`^aico idle · ${COST}$`))
})

test('the longest slug and the largest spend fit in 70 cells', async ($, on) => {
  const w = makeWorld()
  w.slug = 'a'.repeat(64)
  w.spend = 9007199254740991
  const clock = await boot($, on, w)
  await clock.advance(0)
  const line = last(w) ?? ''
  expect(cellWidth(line)).toBeLessThanOrEqual(70)
  for (const part of ['W2 ', 'm · ', ' tax ']) expect(line).toContain(part)
})

test('a quiet run within one minute writes nothing new', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ savvy: true, tax: false })
  const clock = await boot($, on, w)
  const before = w.statusCalls
  await clock.advance(10_000)
  expect(w.statusCalls).toBe(before)
})

test('a second session.start writes the next line even when it equals the last', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  const before = w.statuses.length
  const line = last(w)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  expect(w.statuses.length).toBeGreaterThan(before)
  expect(w.statuses.slice(before)).toContain(line)
})

test('a refused ui.status raises no error and the line is written on the next set', async ($, on) => {
  const w = makeWorld()
  w.failStatus = 1
  const clock = await boot($, on, w)
  await clock.advance(4100)
  expect(w.statusCalls).toBeGreaterThan(1)
  expect(last(w)).toMatch(/^W2 /)
})
