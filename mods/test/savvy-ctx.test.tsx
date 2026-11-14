import { expect, mock, test } from 'claude-code/testing'

const START = Date.parse('2026-10-26T10:00:00Z')
const MODS = {
  savvy: { enabled: true, pane: 'auto' },
  cache_tax: { enabled: false, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
}
const SETTINGS = JSON.stringify({ revision: 1, roles: { 'frontend-engineer': { name: 'Freya' } }, mods: MODS })
const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
const VIEW = {
  v: 1,
  slug: 'demo',
  state: 'running',
  started: STAMP(START),
  ended: null,
  outcome: null,
  wave: 1,
  gates: [],
  round: 0,
  tier: 'high',
  steps: [],
  warnings: [],
}
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
const fail = { value: { exitCode: 2, stdout: '', stderr: 'refused' } }

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Info = { id: string; description: string; type: string; status: string }

function makeWorld() {
  return {
    agents: [] as Info[],
    mtime: 1,
    view: { ...VIEW, cap: 120000, handover: 108000 } as Record<string, unknown>,
    agentAnswer: ((ids: string[]) => ok(JSON.stringify({ v: 1, agents: ids.map(agent => ({ agent, ctx: 110000 })) }))) as (ids: string[]) => unknown,
    leadAnswer: ok(JSON.stringify({ v: 1, ctx: 42000, peak: 50000, at: '2026-10-26T10:05:00Z' })) as unknown,
    agentCalls: [] as Call[],
    leadCalls: [] as Call[],
    statuses: [] as (string | undefined)[],
  }
}
type World = ReturnType<typeof makeWorld>

const running = (n: number): Info[] => Array.from({ length: n }, (_, i) => ({ id: `agent${i}`, description: 'x', type: 'aico:frontend-engineer', status: 'running' }))

async function boot($: Env[0], on: Env[1], world: World) {
  const clock = mock.clock(on, { now: START + 60_000 })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: world.mtime, isLink: false } }) as never)
  on('agent.list', () => ({ value: world.agents }) as never)
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
  on('process.run', ((_: unknown, e: Call) => {
    const script = e.argv[1].replace(/\\/g, '/').split('/').pop()
    if (script === 'settings.mjs') return ok(SETTINGS)
    if (script === 'run-state.mjs') return ok(JSON.stringify({ slug: 'demo', view: world.view }))
    if (script === 'ledger.mjs') {
      world.agentCalls.push(e)
      return world.agentAnswer(e.argv.slice(3, -1))
    }
    if (script === 'lead-handover.mjs') {
      world.leadCalls.push(e)
      return world.leadAnswer
    }
    return fail
  }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  return clock
}

function pane(bodyColumns = 63) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: 'aico-run',
    surface: 'terminal',
    props: { title: 'Savvy', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as const
}

async function rows($: Env[0], width = 63): Promise<string[]> {
  const ui = await $.ui.mount(pane(width))
  const all = await ui.findAll({ type: 'Text' })
  const out = all.map(t => t.text ?? '')
  await ui.unmount()
  return out
}

test('a running agent at 110000 tokens shows ctx 110.0k near cap', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  const text = (await rows($)).join('\n')
  expect(text).toContain('ctx 110.0k near cap')
  expect(w.agentCalls[0].argv.slice(2)).toEqual(['agent-ctx', 'agent0', '--json'])
  expect(w.agentCalls[0].init.timeoutMs).toBe(5000)
})

test('a count past the run cap 120000 shows over cap and a low count shows no note', async ($, on) => {
  const w = makeWorld()
  w.agents = running(2)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx: 125000 }, { agent: ids[1], ctx: 12000 }] }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  const all = await rows($)
  expect(all.some(r => r.endsWith('ctx 125.0k over cap'))).toBe(true)
  expect(all.some(r => r.endsWith('ctx 12.0k'))).toBe(true)
})

test('the Lead row comes first, from lead-handover ctx --json', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await clock.advance(2000)
  const all = await rows($)
  expect(all[0]).toBe('Lead ctx 42.0k')
  expect(w.leadCalls[0].argv.slice(2)).toEqual(['ctx', 'demo', '--json'])
  expect(w.leadCalls[0].init.timeoutMs).toBe(1000)
})

test('the Lead row is read again only when lead-context.json changes', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await clock.advance(8000)
  const before = w.leadCalls.length
  expect(before).toBe(1)
  w.mtime = 7
  w.leadAnswer = ok(JSON.stringify({ v: 1, ctx: 110000, peak: 110000, at: '2026-10-26T10:06:00Z' }))
  await clock.advance(4000)
  expect(w.leadCalls.length).toBeGreaterThan(before)
  expect((await rows($))[0]).toBe('Lead ctx 110.0k near cap')
})

test('failures draw ctx ? and never block the pane', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  w.agentAnswer = () => fail
  w.leadAnswer = fail
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  const all = await rows($)
  expect(all[0]).toBe('Lead ctx ?')
  expect(all.some(r => r.endsWith('ctx ?'))).toBe(true)
  expect(all.join('\n')).toContain('Run      demo')
})

test('a guard failure and null counts draw ctx ?', async ($, on) => {
  const w = makeWorld()
  w.agents = running(2)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx: null }, { agent: ids[1], ctx: '5' }] }))
  w.leadAnswer = ok(JSON.stringify({ v: 1, ctx: 1.5, peak: null, at: null }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  const all = await rows($)
  expect(all[0]).toBe('Lead ctx ?')
  expect(all.filter(r => r.endsWith('ctx ?')).length).toBe(3)
})

test('12 running agents make 2 agent-ctx calls in one poll', async ($, on) => {
  const w = makeWorld()
  w.agents = running(12)
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.agentCalls.length).toBe(2)
  expect(w.agentCalls[0].argv.slice(3, -1).length).toBe(8)
  expect(w.agentCalls[1].argv.slice(3, -1).length).toBe(4)
})

test('no agent runs, no agent-ctx call', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  await clock.advance(30_000)
  expect(w.agentCalls).toEqual([])
})

test('an agent id that is not a plain id never reaches argv', async ($, on) => {
  const w = makeWorld()
  w.agents = [
    { id: '--json', description: 'x', type: 'aico:frontend-engineer', status: 'running' },
    { id: 'a b', description: 'x', type: 'aico:frontend-engineer', status: 'running' },
    { id: 'good-1', description: 'x', type: 'aico:frontend-engineer', status: 'running' },
  ]
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.agentCalls.map(c => c.argv.slice(2))).toEqual([['agent-ctx', 'good-1', '--json']])
})

test('a poll still running at the next 10 s mark starts no second poll', async ($, on) => {
  const w = makeWorld()
  w.agents = running(24)
  w.agentAnswer = () => new Promise(() => undefined)
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  await clock.advance(10_000)
  await clock.advance(5000)
  const keys = w.agentCalls.map(c => c.argv.slice(2).join(' '))
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys.length).toBeLessThanOrEqual(3)
})

test('the counts come from state: a fresh mount draws them with no new call', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  const agentCalls = w.agentCalls.length
  const leadCalls = w.leadCalls.length
  const first = await rows($)
  const second = await rows($)
  expect(second).toEqual(first)
  expect(first[0]).toBe('Lead ctx 42.0k')
  expect(first.some(r => r.endsWith('ctx 110.0k near cap'))).toBe(true)
  expect(w.agentCalls.length).toBe(agentCalls)
  expect(w.leadCalls.length).toBe(leadCalls)
})

test('a failed Lead read is tried again on the next tick', async ($, on) => {
  const w = makeWorld()
  w.leadAnswer = fail
  const clock = await boot($, on, w)
  const before = w.leadCalls.length
  w.leadAnswer = ok(JSON.stringify({ v: 1, ctx: 42000, peak: 50000, at: '2026-10-26T10:05:00Z' }))
  await clock.advance(2000)
  expect(w.leadCalls.length).toBeGreaterThan(before)
  expect((await rows($))[0]).toBe('Lead ctx 42.0k')
})

test('the status line is unchanged by the ctx rows', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.statuses.filter(t => t !== undefined && t.includes('ctx'))).toEqual([])
  expect(w.statuses.some(t => t !== undefined && /^W1 S\? /.test(t))).toBe(true)
})

test('at 20 columns the cap note stays whole and no row is cut', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx: 125000 }] }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  for (const width of [20, 24, 12]) {
    const all = await rows($, width)
    expect(all.some(r => r.includes('over cap'))).toBe(true)
    expect(all.some(r => r.includes('ctx 125.0k'))).toBe(true)
    expect(all.filter(r => r.includes('…') && /ctx|cap|over/.test(r))).toEqual([])
  }
})

test('the savvy status part carries over cap, near cap or nothing', async ($, on) => {
  const w = makeWorld()
  w.agents = running(2)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx: 110000 }, { agent: ids[1], ctx: 125000 }] }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.statuses.some(t => t !== undefined && t.includes('over cap'))).toBe(true)
  expect(w.statuses.some(t => t !== undefined && t.includes('near cap'))).toBe(false)
})

test('a low count leaves the status line as it was', async ($, on) => {
  const w = makeWorld()
  w.agents = running(1)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx: 12000 }] }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.statuses.filter(t => t !== undefined && t.includes('cap'))).toEqual([])
})

test('a Lead near cap with no agent in state shows near cap in the status part', async ($, on) => {
  const w = makeWorld()
  w.leadAnswer = ok(JSON.stringify({ v: 1, ctx: 110000, peak: 110000, at: '2026-10-26T10:05:00Z' }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  expect(w.statuses.some(t => t !== undefined && t.includes('near cap'))).toBe(true)
})

async function withView($: Env[0], on: Env[1], over: Record<string, unknown>, ctx: number) {
  const w = makeWorld()
  w.view = { ...VIEW, ...over }
  w.agents = running(1)
  w.agentAnswer = ids => ok(JSON.stringify({ v: 1, agents: [{ agent: ids[0], ctx }] }))
  const clock = await boot($, on, w)
  await clock.advance(10_000)
  return { w, all: await rows($) }
}
const RUN_CAP = { cap: 120000, handover: 108000 }

test('AC11: cap 120000 and handover 108000: 108000 is plain, no cap word anywhere', async ($, on) => {
  const r = await withView($, on, RUN_CAP, 108000)
  expect(r.all.some(x => x.endsWith('ctx 108.0k'))).toBe(true)
  expect(r.all.join('
')).not.toContain('cap')
  expect(r.w.statuses.filter(t => t !== undefined && t.includes('cap'))).toEqual([])
})

test('AC11: 108001 under cap 120000 is near cap, in the row and the status part', async ($, on) => {
  const r = await withView($, on, RUN_CAP, 108001)
  expect(r.all.some(x => x.endsWith('ctx 108.0k near cap'))).toBe(true)
  expect(r.w.statuses.some(t => t !== undefined && t.includes('near cap'))).toBe(true)
})

test('AC11: 120000 is still near cap, not over', async ($, on) => {
  const r = await withView($, on, RUN_CAP, 120000)
  expect(r.all.some(x => x.endsWith('ctx 120.0k near cap'))).toBe(true)
  expect(r.w.statuses.some(t => t !== undefined && t.includes('over cap'))).toBe(false)
})

test('AC11: 121000 under cap 120000 is over cap, in the row and the status part', async ($, on) => {
  const r = await withView($, on, RUN_CAP, 121000)
  expect(r.all.some(x => x.endsWith('ctx 121.0k over cap'))).toBe(true)
  expect(r.w.statuses.some(t => t !== undefined && t.includes('over cap'))).toBe(true)
})

test('AC9: a view without cap and handover is quiet at 110000 and 162000', async ($, on) => {
  const r = await withView($, on, { cap: undefined, handover: undefined }, 162000)
  expect(r.all.some(x => x.endsWith('ctx 162.0k'))).toBe(true)
  expect(r.w.statuses.filter(t => t !== undefined && t.includes('cap'))).toEqual([])
})

test('AC9: a view without cap and handover marks near cap at 170000', async ($, on) => {
  const r = await withView($, on, { cap: undefined, handover: undefined }, 170000)
  expect(r.all.some(x => x.endsWith('ctx 170.0k near cap'))).toBe(true)
})

test('AC9: a view without cap and handover marks over cap at 181000', async ($, on) => {
  const r = await withView($, on, { cap: undefined, handover: undefined }, 181000)
  expect(r.all.some(x => x.endsWith('ctx 181.0k over cap'))).toBe(true)
})

test('a view with null cap and handover reads 162000 and 180000', async ($, on) => {
  const r = await withView($, on, { cap: null, handover: null }, 170000)
  expect(r.all.some(x => x.endsWith('ctx 170.0k near cap'))).toBe(true)
})

test('a hostile view cap (string) never lowers the line below 180000 and keeps the pane', async ($, on) => {
  const r = await withView($, on, { cap: '120000', handover: '108000' }, 110000)
  expect(r.all.join('
')).not.toContain('110.0k near cap')
  expect(r.all.join('
')).not.toContain('110.0k over cap')
})

test('a hostile view cap (out of range) never lowers the line below 180000', async ($, on) => {
  const r = await withView($, on, { cap: 59999, handover: 1 }, 110000)
  expect(r.all.join('
')).not.toContain('110.0k near cap')
  expect(r.all.join('
')).not.toContain('110.0k over cap')
})

test('wcag.M10: the over mark is a word at the end of the row text', async ($, on) => {
  const r = await withView($, on, RUN_CAP, 125000)
  expect(r.all.filter(t => t.includes('ctx 125.0k'))).toEqual([expect.stringMatching(/ over cap$/)])
})
