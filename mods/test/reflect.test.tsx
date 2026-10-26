import { expect, mock, test } from 'claude-code/testing'

import { cellWidth } from '../lib/format.mjs'

const START = Date.parse('2026-10-26T10:00:00Z')
const MIN = 60_000
const STAMP = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')

const MODS = (reflect: Record<string, unknown>) => ({
  savvy: { enabled: false, pane: 'command' },
  cache_tax: { enabled: false, pane: 'command' },
  reflect,
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
})
const ON = { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' }
const SETTINGS = (reflect: Record<string, unknown> = ON) =>
  JSON.stringify({ revision: 1, roles: { 'backend-engineer': { name: 'Ben' } }, mods: MODS(reflect) })

type StepRow = { step: string; role: string; status: string; round: number; file: string; mtime: string }
const row = (step: string, role: string, mtime = START): StepRow => ({ step, role, status: 'done', round: 0, file: `${step}-${role}.md`, mtime: STAMP(mtime) })
const view = (steps: StepRow[]) => ({
  v: 1, slug: 'demo', state: 'running', started: STAMP(START), ended: null, outcome: null, wave: 1,
  gates: [], round: 0, tier: 'high', steps, warnings: [],
})
const NONE = JSON.stringify({ slug: null, view: null })

const LESSON_A = 'security finding in Step 07: token logged in clear text'
const LESSON_B = 'Handoff failed lint: missing Did section'
const check = (over: Record<string, unknown> = {}) => ({
  v: 1, step: '07', role: 'backend-engineer', status: 'done',
  did: 'Added the retry wrapper', wrong: ['security blocker: 1'], remember: 'Retries stop at 3',
  lessons: [{ role: 'backend-engineer', text: LESSON_A }, { role: 'backend-engineer', text: LESSON_B }], ...over,
})
const RETRO = {
  v: 1, slug: 'demo', outcome: 'ship',
  top_spend: [{ step: '07', role: 'qa', spend: 123456 }, { step: '05', role: 'backend-engineer', spend: 99 }],
  top_time: [{ step: '07', role: 'qa', ms: 125000 }],
  fix_causes: { contract: 1, spec: 0, security: 3, test: 2 },
  lessons: [{ role: 'lead', text: 'security findings caused 3 Fix-round items; check the security rules before review' }],
  warnings: [],
}
const ok = (value: unknown) => ({ value: { exitCode: 0, stdout: `${typeof value === 'string' ? value : JSON.stringify(value)}\r\n`, stderr: '' } })
const refused = (why: string) => ({ value: { exitCode: 2, stdout: `refused: ${why}\n`, stderr: '' } })

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }

function makeWorld() {
  return {
    now: START + 5 * MIN,
    settings: SETTINGS(),
    steps: [row('05', 'backend-engineer')] as StepRow[],
    isActive: true,
    runMtime: 1,
    checks: {} as Record<string, unknown>,
    retro: ok(RETRO) as unknown,
    accept: ok('accepted') as unknown,
    addMod: ok('') as unknown,
    handoff: '# Handoff\nDid things.',
    isHandoffLink: false,
    gate: undefined as Promise<void> | undefined,
    statuses: [] as (string | undefined)[],
    logs: [] as string[],
    toasts: [] as string[],
    opened: [] as string[],
    calls: [] as string[][],
    models: [] as { prompt: unknown; model: string }[],
    modelReply: { isAnswered: true, text: 'remember: Use the shared retry\nlesson: backend-engineer prefers one retry wrapper', usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 } } as unknown,
    writes: 0,
  }
}
type World = ReturnType<typeof makeWorld>

async function boot($: Env[0], on: Env[1], world: World, surface: 'terminal' | 'desktop' = 'terminal') {
  const clock = mock.clock(on, { now: world.now })
  on('session.root', () => ({ value: '/work' }))
  on('session.model', (() => ({ value: 'claude-sonnet-5-5' })) as never)
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: world.runMtime, isLink: world.isHandoffLink } }) as never)
  on('fs.read', (() => ({ value: world.handoff })) as never)
  on('fs.write', (() => {
    world.writes++
    return { deny: 'no write' }
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', (_: unknown, e: { text: string | undefined }) => (world.statuses.push(e.text), { value: undefined }))
  on('ui.log', (_: unknown, e: { text: string }) => (world.logs.push(e.text), { value: undefined }) as never)
  on('ui.toast', (_: unknown, e: { text: string }) => (world.toasts.push(e.text), { value: undefined }) as never)
  on('ui.open', ((_: unknown, e: { id: string }) => (world.opened.push(e.id), { value: { isPlaced: true } })) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.run', () => ({ text: 'engine' }))
  on('agent.spawn', (() => ({ model: 'm', agentId: 'a1' })) as never)
  on('model.complete', ((_: unknown, e: { model: string; promptBlocks?: unknown }) => {
    world.models.push({ prompt: e.promptBlocks, model: e.model })
    return { value: world.modelReply }
  }) as never)
  on('process.run', (async (_: unknown, e: Call) => {
    const script = e.argv[1].replace(/\\/g, '/').split('/').pop() ?? ''
    const args = e.argv.slice(2)
    world.calls.push([script, ...args])
    if (script === 'settings.mjs') return ok(world.settings)
    if (script === 'run-state.mjs') {
      if (world.gate !== undefined) await world.gate
      return ok(world.isActive ? { slug: 'demo', view: view(world.steps) } : JSON.parse(NONE))
    }
    if (script === 'reflect.mjs' && args[0] === 'step') {
      const found = world.checks[args[2]]
      return typeof found === 'function' ? found() : (found ?? refused('unknown file'))
    }
    if (script === 'reflect.mjs' && args[0] === 'retro') return world.retro
    if (script === 'lessons.mjs') return world.accept
    if (script === 'ledger.mjs') return world.addMod
    return { value: { exitCode: 2, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await $.agent.spawn({ subagentType: 'aico:backend-engineer', prompt: 'Output: .company/work/demo/05-backend-engineer.md\nName: Ben\n' })
  await clock.advance(2500)
  return clock
}

function pane(surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 63) {
  return {
    plugin: 'aico',
    component: 'Pane',
    requestId: 'aico-reflect',
    surface,
    props: { title: 'Reflect', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const
}
type Ui = Awaited<ReturnType<Env[0]['ui']['mount']>>
async function lines(ui: Ui) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
}
const last = (w: World) => w.statuses[w.statuses.length - 1]
const stepCalls = (w: World) => w.calls.filter(c => c[0] === 'reflect.mjs' && c[1] === 'step')
const lessonCalls = (w: World) => w.calls.filter(c => c[0] === 'lessons.mjs')

// A Step file that appears after Reflect first saw the run.
async function addStep(w: World, clock: Awaited<ReturnType<typeof boot>>, step = '07', role = 'backend-engineer', mtime = START + MIN) {
  w.steps = [...w.steps, row(step, role, mtime)]
  w.runMtime++
  await clock.advance(2100)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a new Step file gets a check: did, went wrong, remember, suggested Lessons (${surface})`, async ($, on) => {
    const w = makeWorld()
    w.checks['07-backend-engineer.md'] = ok(check())
    const clock = await boot($, on, w, surface)
    expect(stepCalls(w)).toEqual([])
    await addStep(w, clock)
    expect(stepCalls(w)).toEqual([['reflect.mjs', 'step', 'demo', '07-backend-engineer.md', '--json']])
    expect(w.logs.length).toBeGreaterThan(0)
    expect(w.logs[0].split('\n').length).toBeLessThanOrEqual(5)
    const ui = await $.ui.mount(pane(surface))
    const rows = (await lines(ui)).join('\n')
    expect(rows).toContain('Added the retry wrapper')
    expect(rows).toContain('security blocker: 1')
    expect(rows).toContain('Retries stop at 3')
    expect(rows).toContain(LESSON_A.slice(0, 20))
    expect(rows).toContain('suggested')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    expect(last(w)).toContain('reflect 2 suggested')
    await ui.unmount()
  })
}

test('Step files present when Reflect first sees the run are not checked; a changed file is, an unchanged one is not', async ($, on) => {
  const w = makeWorld()
  w.checks['05-backend-engineer.md'] = ok(check({ step: '05', lessons: [] }))
  const clock = await boot($, on, w)
  await clock.advance(12_000)
  expect(stepCalls(w)).toEqual([])
  w.steps = [row('05', 'backend-engineer', START + 3 * MIN)]
  w.runMtime++
  await clock.advance(2100)
  expect(stepCalls(w)).toHaveLength(1)
  await clock.advance(30_000)
  expect(stepCalls(w)).toHaveLength(1)
})

test('Accept runs lessons.mjs with --role and --text as separate arguments and writes only that Lesson', async ($, on) => {
  const w = makeWorld()
  const hostile = 'security finding in Step 07: "; rm -rf / && echo $(x)'
  w.checks['07-backend-engineer.md'] = ok(check({ lessons: [{ role: 'backend-engineer', text: hostile }, { role: 'backend-engineer', text: LESSON_B }] }))
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount(pane())
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBe(4)
  expect(lessonCalls(w)).toEqual([])
  await ui.press({ key: buttons[0].key as string })
  expect(lessonCalls(w)).toEqual([['lessons.mjs', 'accept', '--role', 'backend-engineer', '--text', hostile]])
  expect(last(w)).toContain('reflect 1 suggested')
  const rows = (await lines(ui)).join('\n')
  expect(rows).toContain('Saved')
  expect(rows).not.toContain('rm -rf')
  await ui.unmount()
})

test('Decline writes nothing and removes the Lesson; the status part goes at zero; session end writes nothing', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount(pane())
  const buttons = await ui.findAll({ type: 'Button' })
  const decline = buttons.filter(b => String(b.text).startsWith('Decline'))
  await ui.press({ key: decline[0].key as string })
  expect(last(w)).toContain('reflect 1 suggested')
  await ui.press({ key: decline[1].key as string })
  expect(last(w)).toBeUndefined()
  expect(lessonCalls(w)).toEqual([])
  expect(w.writes).toBe(0)
  await ui.unmount()
})

test('a pending Lesson with no answer is never written, not even when the session starts again', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(30_000)
  expect(lessonCalls(w)).toEqual([])
  expect(w.writes).toBe(0)
})

test('a refused Accept says so and does not keep the suggestion', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  w.accept = refused('duplicate lesson')
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: (await ui.findAll({ type: 'Button' }))[0].key as string })
  const rows = (await lines(ui)).join('\n')
  expect(rows).toContain('Not saved: duplicate lesson')
  await ui.unmount()
})

test('an Accept whose script cannot run says not saved and keeps nothing written', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  w.accept = { value: { exitCode: 0, stdout: 'something else', stderr: '' } }
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: (await ui.findAll({ type: 'Button' }))[0].key as string })
  expect((await lines(ui)).join('\n')).toContain('Not saved')
  await ui.unmount()
})

test('the retrospective runs once when the run ends: top spend, top time, causes, Lessons from the script', async ($, on) => {
  const w = makeWorld()
  const clock = await boot($, on, w)
  w.isActive = false
  w.runMtime++
  await clock.advance(2100)
  await clock.advance(30_000)
  expect(w.calls.filter(c => c[1] === 'retro')).toEqual([['reflect.mjs', 'retro', 'demo', '--json']])
  const ui = await $.ui.mount(pane())
  const rows = (await lines(ui)).join('\n')
  expect(rows).toContain('Retrospective demo')
  expect(rows).toContain('ship')
  expect(rows).toContain('07 qa 123456')
  expect(rows).toContain('2m05s')
  expect(rows).toContain('security 3')
  expect(rows).toContain('security findings caused 3')
  expect(last(w)).toContain('reflect 1 suggested')
  await ui.unmount()
})

test('step_check off skips the Step script; retrospective off skips the retro script', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, step_check: false, retrospective: false })
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  w.isActive = false
  w.runMtime++
  await clock.advance(12_000)
  expect(w.calls.filter(c => c[0] === 'reflect.mjs')).toEqual([])
})

test('off: no script, no status part, an empty pane and the command says it is off', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, enabled: false })
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  expect(w.calls.filter(c => c[0] === 'reflect.mjs' || c[0] === 'lessons.mjs')).toEqual([])
  expect(w.statuses.filter(s => s !== undefined)).toEqual([])
  const out = await $.command.run({ command: 'aico-reflect', args: '' } as never)
  expect(JSON.stringify(out)).toContain('reflect is off')
  expect(w.opened).not.toContain('aico-reflect')
})

test('the command opens the pane when on', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const out = await $.command.run({ command: 'aico-reflect', args: '' } as never)
  expect(JSON.stringify(out)).not.toContain('is off')
  expect(w.opened).toContain('aico-reflect')
})

test('model mode is off by default: no model call, nothing in the ledger', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  w.isActive = false
  w.runMtime++
  await clock.advance(12_000)
  expect(w.models).toEqual([])
  expect(w.calls.filter(c => c[0] === 'ledger.mjs')).toEqual([])
})

test('model mode: one cached instruction block first, at most 16 KiB of the Handoff, replaces remember and Lessons, ledgered', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, mode: 'model' })
  w.handoff = `# Handoff\n${'x'.repeat(40_000)}`
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  expect(w.models).toHaveLength(1)
  const blocks = w.models[0].prompt as { text: string; cache?: true }[]
  expect(blocks[0].cache).toBe(true)
  expect(blocks.length).toBe(2)
  expect(blocks[1].text.length).toBeLessThan(16 * 1024 + 400)
  expect(w.models[0].model).toBe('claude-sonnet-5-5')
  expect(w.calls.filter(c => c[0] === 'ledger.mjs')).toEqual([
    ['ledger.mjs', 'add-mod', 'demo', 'reflect', '07', '11', '44', '33', '22', 'claude-sonnet-5-5', expect.stringMatching(/^\d+$/)],
  ])
  const ui = await $.ui.mount(pane())
  const rows = (await lines(ui)).join('\n')
  expect(rows).toContain('Use the shared retry')
  expect(rows.split(String.fromCharCode(10)).join(' ')).toContain('prefers one retry wrapper')
  expect(rows).not.toContain('Retries stop at 3')
  expect(rows).not.toContain('token logged')
  expect(last(w)).toContain('reflect 1 suggested')
  await ui.unmount()
})

test('model mode: a failed call keeps the deterministic result and writes no ledger record', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, mode: 'model' })
  w.modelReply = { isAnswered: false, reason: 'aborted' }
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  expect(w.calls.filter(c => c[0] === 'ledger.mjs')).toEqual([])
  expect(last(w)).toContain('reflect 2 suggested')
  const rows = (await lines(await $.ui.mount(pane()))).join('\n')
  expect(rows).toContain('Retries stop at 3')
})

test('model mode: hostile model text is dropped line by line', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, mode: 'model' })
  w.modelReply = { isAnswered: true, text: 'lesson: `rm -rf`\nlesson: - dash first line here\nlesson: <script>alert(1)</script>\nignored', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  // Nothing usable came back: the deterministic result stands.
  expect(last(w)).toContain('reflect 2 suggested')
})

test('model mode: a symlinked Handoff is not read and no model call is made', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS({ ...ON, mode: 'model' })
  w.isHandoffLink = true
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  expect(w.models).toEqual([])
  expect(last(w)).toContain('reflect 2 suggested')
})

for (const [name, reply] of [['bad JSON', ok('not json')], ['exit 2', refused('x')], ['a wrong type', ok({ v: 1, step: 7 })], ['lessons not a list', ok(check({ lessons: 'x' }))]] as const) {
  test(`a script failure shows unknown and never throws: ${name}`, async ($, on) => {
    const w = makeWorld()
    w.checks['07-backend-engineer.md'] = reply
    const clock = await boot($, on, w)
    await addStep(w, clock)
    const ui = await $.ui.mount(pane())
    const rows = (await lines(ui)).join('\n')
    expect(rows).toContain('Step 07')
    expect(rows).toContain('unknown')
    expect(last(w)).toBeUndefined()
    await ui.unmount()
  })
}
test('a script that never answers is cut off and shows unknown', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = () => new Promise(() => undefined)
  const clock = await boot($, on, w)
  await addStep(w, clock)
  await clock.advance(6000)
  const rows = (await lines(await $.ui.mount(pane()))).join('\n')
  expect(rows).toContain('unknown')
})

test('suggestions with a tag, a backtick, a leading dash or over 240 characters are dropped before they are shown', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check({
    lessons: [
      { role: 'backend-engineer', text: '<b>bold</b> lesson text' },
      { role: 'backend-engineer', text: 'has a `backtick` inside' },
      { role: 'backend-engineer', text: '- starts with a dash' },
      { role: 'backend-engineer', text: 'x'.repeat(241) },
      { role: 'Bad Role', text: 'fine text here for a role' },
      { role: 'backend-engineer', text: 'one good lesson stays' },
    ],
  }))
  const clock = await boot($, on, w)
  await addStep(w, clock)
  expect(last(w)).toContain('reflect 1 suggested')
})

test('the same Lesson is not listed twice', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  w.checks['09-backend-engineer.md'] = ok(check({ step: '09' }))
  const clock = await boot($, on, w)
  await addStep(w, clock)
  await addStep(w, clock, '09', 'backend-engineer', START + 2 * MIN)
  expect(last(w)).toContain('reflect 2 suggested')
})

test('handoff text is drawn as plain Text only, with control characters replaced', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check({ did: 'Did\u001b[31m red \u0007bell [link](http://x) **bold**', remember: 'a‮b' }))
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount(pane())
  expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
  expect(await ui.findAll({ type: 'Link' })).toEqual([])
  const rows = (await lines(ui)).join('\n')
  expect(rows).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f‮]/)
  await ui.unmount()
})

for (const width of [39, 63]) {
  test(`no row is wider than ${width} cells, with long and wide text and a retrospective`, async ($, on) => {
    const w = makeWorld()
    w.checks['07-backend-engineer.md'] = ok(check({
      did: '漢字'.repeat(60),
      wrong: ['security blocker: 1', 'lint: ' + 'y'.repeat(150)],
      remember: 'z'.repeat(150),
      lessons: [{ role: 'backend-engineer', text: '漢字'.repeat(50) }, { role: 'backend-engineer', text: 'w'.repeat(200) }],
    }))
    const clock = await boot($, on, w)
    await addStep(w, clock)
    w.isActive = false
    w.runMtime++
    await clock.advance(12_000)
    const ui = await $.ui.mount(pane('terminal', width))
    const all = await lines(ui)
    expect(all.length).toBeGreaterThan(10)
    for (const r of all) expect(cellWidth(r)).toBeLessThanOrEqual(width)
    for (const b of await ui.findAll({ type: 'Button' })) expect(cellWidth(String(b.text)) + 4).toBeLessThanOrEqual(width)
    await ui.unmount()
  })
}

test('no run: the pane says so and there is no status part', async ($, on) => {
  const w = makeWorld()
  w.isActive = false
  await boot($, on, w)
  const ui = await $.ui.mount(pane())
  expect((await lines(ui)).join('\n')).toContain('No aico run is active.')
  expect(last(w)).toBeUndefined()
  await ui.unmount()
})

test('no hook waits for Reflect: session start and a turn return while run-state has not answered', async ($, on) => {
  const w = makeWorld()
  let release: () => void = () => undefined
  w.gate = new Promise<void>(resolve => {
    release = resolve
  })
  await boot($, on, w)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  release()
})

test('surfaces other than terminal and desktop draw nothing', async ($, on) => {
  const w = makeWorld()
  w.checks['07-backend-engineer.md'] = ok(check())
  const clock = await boot($, on, w)
  await addStep(w, clock)
  const ui = await $.ui.mount({ ...pane(), surface: 'vscode' } as never)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
})
