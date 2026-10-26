import { expect, mock, test } from 'claude-code/testing'

import { cellWidth } from '../lib/format.mjs'

const START = Date.parse('2026-10-26T10:00:00Z')
const MODS = (savvy: { enabled: boolean; pane: string }) => ({
  savvy,
  cache_tax: { enabled: false, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
})
const SETTINGS = (savvy = { enabled: true, pane: 'auto' }) =>
  JSON.stringify({ revision: 1, roles: { 'frontend-engineer': { name: 'Freya' }, 'backend-engineer': { name: 'Ben' } }, mods: MODS(savvy) })

const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
const view = (over: Record<string, unknown> = {}) => ({
  v: 1,
  slug: 'demo',
  state: 'running',
  started: STAMP(START),
  ended: null,
  outcome: null,
  wave: 2,
  gates: [
    { gate: 'brief', result: 'passed', at: STAMP(START + 1000) },
    { gate: 'plan', result: 'passed', at: STAMP(START + 2000) },
    { gate: 'ship', result: 'changed', at: STAMP(START + 3000) },
  ],
  round: 1,
  tier: 'high',
  steps: [
    { step: '04', role: 'architect', status: 'done', round: 0, file: '04-architect.md', mtime: STAMP(START + 4000) },
    { step: '05', role: 'backend-engineer', status: 'done', round: 0, file: '05-backend-engineer.md', mtime: STAMP(START + 5000) },
  ],
  warnings: [],
  ...over,
})
const ACTIVE = (v: unknown, slug = 'demo') => JSON.stringify({ slug, view: v })
const NONE = JSON.stringify({ slug: null, view: null })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Info = { id: string; description: string; type: string; status: string; name?: string }

// What stands beneath the mod: scripts, files, agents, and the panes the mod opens.
function makeWorld() {
  return {
    now: START + 12 * 60_000,
    settings: SETTINGS(),
    active: ACTIVE(view()) as string | (() => unknown),
    show: ok(JSON.stringify(view({ state: 'ended', ended: STAMP(START + 30 * 60_000), outcome: 'ship' }))) as unknown,
    mtime: 1,
    agents: [] as Info[],
    isPlaced: true,
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    runStateCalls: [] as string[][],
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], world: World, surface: 'terminal' | 'desktop' = 'terminal') {
  const clock = mock.clock(on, { now: world.now })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: world.mtime, isLink: false } }) as never)
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
  on('process.run', ((_: unknown, e: Call) => {
    const script = e.argv[1].replace(/\\/g, '/').split('/').pop()
    if (script === 'settings.mjs') return ok(world.settings)
    if (script === 'run-state.mjs') {
      world.runStateCalls.push(e.argv.slice(2))
      if (e.argv[2] === 'show') return world.show
      return typeof world.active === 'function' ? world.active() : ok(world.active)
    }
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(2500)
  return clock
}

function pane(surface: 'terminal' | 'desktop', bodyColumns = 63) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: 'aico-run',
    surface,
    props: { title: 'Savvy', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as const
}

async function lines(ui: Awaited<ReturnType<Env[0]['ui']['mount']>>) {
  const all = await ui.findAll({ type: 'Text' })
  return all.map(t => t.text ?? '')
}
const last = (w: World) => w.statuses[w.statuses.length - 1]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`an active run shows wave, Step, Role, Gates, Fix round and time (${surface})`, async ($, on) => {
    const w = makeWorld()
    w.agents = [{ id: 'a1', description: 'x', type: 'aico:frontend-engineer', status: 'running' }]
    const clock = await boot($, on, w, surface)
    await $.agent.spawn({ subagentType: 'aico:frontend-engineer', prompt: 'Output: .company/work/demo/06-frontend-engineer.md\nName: Freya\nBase commit: abc1234\nRisk tier: high\n' })
    await clock.advance(2100)
    const ui = await $.ui.mount(pane(surface))
    const text = (await lines(ui)).join('\n')
    expect(text).toContain('Run      demo')
    expect(text).toContain('Wave     2')
    expect(text).toContain('Step     06 frontend-engineer (Freya)')
    expect(text).toContain('Gates    brief, plan')
    expect(text).toContain('Fix round 1')
    expect(text).toMatch(/Elapsed  12m0\ds/)
    expect(text).toMatch(/06 frontend-engineer \(Freya\) +\d+s/)
    expect(last(w)).toMatch(/^W2 S06 fr-eng 12m$/)
    await ui.unmount()
  })
}

test('without a running subagent the Step is the newest Step file', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await $.ui.mount(pane('terminal'))
  const text = (await lines(ui)).join('\n')
  expect(text).toContain('Step     05 backend-engineer (Ben)')
  expect(text).toContain('No subagent running.')
  expect(last(w)).toMatch(/^W2 S05 ba-eng 12m$/)
  await ui.unmount()
})

test('pane auto opens the pane unasked when a run becomes active', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  expect(w.opened).toEqual(['aico-run'])
})

test('pane command never opens unasked, the command opens it', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ enabled: true, pane: 'command' })
  await boot($, on, w)
  expect(w.opened).toEqual([])
  expect(last(w)).toContain('W2 S05')
  const out = await $.command.run({ command: 'aico-run', args: '' } as never)
  expect(JSON.stringify(out)).not.toContain('is off')
  expect(w.opened).toEqual(['aico-run'])
})

test('below 110 columns the pane is not placed and the status line holds every field', async ($, on) => {
  const w = makeWorld()
  w.isPlaced = false
  await boot($, on, w)
  expect(w.opened).toEqual(['aico-run'])
  const status = last(w) ?? ''
  for (const part of ['W2', 'S05', 'ba-eng', '12m']) expect(status).toContain(part)
  expect(cellWidth(status)).toBeLessThanOrEqual(70)
})

// A row is never wider than the pane body (docked panes measure 39 to 89 cells).
for (const width of [39, 63, 89]) {
  test(`no row is wider than ${width} cells`, async ($, on) => {
    const w = makeWorld()
    const long = 'a'.repeat(60)
    w.active = ACTIVE(view({ slug: long, gates: Array.from({ length: 3 }, () => ({ gate: 'brief', result: 'passed', at: STAMP(START) })) }), long)
    w.settings = JSON.stringify({
      revision: 1,
      roles: { 'backend-engineer': { name: '漢字'.repeat(15) } },
      mods: MODS({ enabled: true, pane: 'auto' }),
    })
    w.agents = Array.from({ length: 14 }, (_, i) => ({ id: `a${i}`, description: 'd', type: 'aico:backend-engineer', status: 'running' }))
    await boot($, on, w)
    const ui = await $.ui.mount(pane('terminal', width))
    const all = await lines(ui)
    expect(all.length).toBeGreaterThan(5)
    for (const row of all) expect(cellWidth(row)).toBeLessThanOrEqual(width)
    expect(all.join('\n')).toContain('Gates')
    await ui.unmount()
  })
}

test('hostile prompt lines are cut and cleaned, a 10 MiB prompt does not hang', async ($, on) => {
  const w = makeWorld()
  w.agents = [{ id: 'a1', description: 'x', type: 'aico:frontend-engineer', status: 'running' }]
  await boot($, on, w)
  const prompt =
    'Output: .company/work/../../etc/05-x.md\nName: Eve\u001b[31m‮' + 'z'.repeat(5000) + '\nRisk tier: high\n' + 'filler\n'.repeat(1_500_000)
  await $.agent.spawn({ subagentType: 'aico:frontend-engineer', prompt })
  const ui = await $.ui.mount(pane('terminal', 39))
  const all = await lines(ui)
  for (const row of all) {
    expect(row).not.toMatch(/[\u0000-\u001f\u007f‮]/)
    expect(cellWidth(row)).toBeLessThanOrEqual(39)
  }
  expect(all.join('\n')).toContain('? frontend-engineer')
  await ui.unmount()
})

test('no active run shows nothing and sets no status', async ($, on) => {
  const w = makeWorld()
  w.active = NONE
  await boot($, on, w)
  expect(w.opened).toEqual([])
  expect(w.statuses.filter(s => s !== undefined && s !== 'aico idle')).toEqual([])
  const ui = await $.ui.mount(pane('terminal'))
  expect(await lines(ui)).toEqual([])
  await ui.unmount()
  const out = await $.command.run({ command: 'aico-run', args: '' } as never)
  expect(JSON.stringify(out)).toContain('No aico run is active')
  expect(w.opened).toEqual([])
})

test('after end the final state stays with outcome and total time', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  expect(last(w)).toContain('W2 S05')
  w.active = NONE
  w.mtime = 2
  await clock.advance(12_000)
  const ui = await $.ui.mount(pane('terminal'))
  const text = (await lines(ui)).join('\n')
  expect(text).toContain('State    ended (ship)')
  expect(text).toContain('Elapsed  30m00s')
  expect(last(w)).toBe('ended ship 30m')
  await ui.unmount()
  // time passes: the total does not
  await clock.advance(60_000)
  expect(last(w)).toBe('ended ship 30m')
})

test('the view follows a change within 5 seconds and calls no script while nothing changed', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  const before = w.runStateCalls.length
  await clock.advance(4000)
  expect(w.runStateCalls.length).toBe(before)
  expect(last(w)).toContain('12m')
  w.active = ACTIVE(view({ wave: 3, round: 2 }))
  w.mtime = 9
  await clock.advance(4000)
  expect(last(w)).toMatch(/^W3 S05 ba-eng 12m$/)
})

const BREAKS: [string, () => unknown][] = [
  ['bad JSON', () => ok('{bad')],
  ['exit code 2', () => ({ value: { exitCode: 2, stdout: ACTIVE(view()), stderr: '' } })],
  ['over-size output', () => ok('x'.repeat(300_000))],
  ['a value outside the allow-list', () => ok(ACTIVE(view({ state: 'sudo' })))],
  ['a rejection', () => ({ deny: 'no process here' })],
]
for (const [name, answer] of BREAKS) {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${name} shows unknown and still draws (${surface})`, async ($, on) => {
      const w = makeWorld()
      w.active = answer as never
      await boot($, on, w, surface)
      const ui = await $.ui.mount(pane(surface, 39))
      const all = await lines(ui)
      expect(all.join('\n')).toContain('Run      ?')
      for (const row of all) expect(cellWidth(row)).toBeLessThanOrEqual(39)
      await ui.unmount()
      expect(w.statuses.filter(s => s !== undefined && s.includes('demo'))).toEqual([])
    })
  }
}

test('a __proto__ key in the answer is dropped, not merged', async ($, on) => {
  const w = makeWorld()
  w.active = '{"slug":null,"view":null,"__proto__":{"polluted":true}}'
  await boot($, on, w)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(w.statuses.filter(s => s !== undefined && s !== 'aico idle')).toEqual([])
})

test('a script that never answers times out and the run shows unknown', async ($, on) => {
  const w = makeWorld()
  const clock = mock.clock(on, { now: w.now })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (() => ({ value: { isPlaced: true } })) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('process.run', ((_: unknown, e: Call) => {
    if (e.argv[1].replace(/\\/g, '/').endsWith('/settings.mjs')) return ok(SETTINGS())
    return new Promise(() => undefined)
  }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  const out = await $.command.run({ command: 'aico-run', args: '' } as never)
  expect(JSON.stringify(out)).toContain('unknown')
})

test('a mod that is off draws nothing, runs no script and sets no status', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ enabled: false, pane: 'auto' })
  const clock = await boot($, on, w)
  await clock.advance(30_000)
  expect(w.runStateCalls).toEqual([])
  expect(w.opened).toEqual([])
  expect(w.statuses.filter(s => s !== undefined && s !== 'aico idle')).toEqual([])
  const ui = await $.ui.mount(pane('terminal'))
  expect(await lines(ui)).toEqual([])
  await ui.unmount()
  const out = await $.command.run({ command: 'aico-run', args: '' } as never)
  expect(JSON.stringify(out)).toContain('savvy is off; switch it on in /aico:settings')
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
