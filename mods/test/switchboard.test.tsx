// Red tests (QA-first, task T26) for mods/switchboard.tsx, built in T27.
// Contracts: aico-mods v2.2 "Switchboard", mod-manifest v1, aico-settings v3.0 (`set-mod`), mod-hook v1 step 7.
// Design: design/terminal-panes.md section 2. Seams the builder meets:
//   - manifests come from `$.fs.list(<plugin root>/hooks/manifests)` and `$.fs.read` of each `.json`;
//   - the command `aico-mods` opens the pane with requestId `aico-mods`;
//   - every row (guard, gate and saver) is one `Button` whose text holds the row title; pressing a saver runs
//     `node <root>/scripts/settings.mjs set-mod <id> on|off`; pressing a locked row only writes the message line;
//   - the group headers and the message line are `Text`; nothing is written by the pane except through settings.mjs.
import { expect, mock, test } from 'claude-code/testing'

const MODS = (seen: boolean, tax = true) => ({
  savvy: { enabled: false, pane: 'command' },
  cache_tax: { enabled: tax, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  efficient_browser_use: { enabled: false },
  switchboard: { enabled: true, seen },
  savings: { enabled: true },
})
const SETTINGS = (seen = true, tax = true) =>
  JSON.stringify({ revision: 1, roles: { qa: { name: 'Quinn' } }, mods: MODS(seen, tax) })

const GUARD = (id: string, rule: string) => ({
  v: 1, id, kind: 'guard', title: `${id} guard`, owner: 'backend-engineer', sessions: 'all', events: ['PreToolUse'], rules: [rule], fail: 'closed', switch: null, lock: true, upstream: null,
})
const SAVER = (id: string, title: string) => ({
  v: 1, id, kind: 'saver', title, owner: 'frontend-engineer', sessions: 'lead', events: [], rules: [], fail: 'open', switch: `mods.${id.replace(/-/g, '_')}.enabled`, lock: false, upstream: null,
})
const FILES = (): Record<string, unknown> => ({
  'cap.json': GUARD('cap', 'cap.M1'),
  'git-add.json': GUARD('git-add', 'git-add.M-SEC1'),
  'cache-tax.json': SAVER('cache-tax', 'Cache clock'),
  'savings.json': SAVER('savings', 'Savings pane'),
  'switchboard.json': SAVER('switchboard', 'Switchboard'),
})

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout: `${stdout}\r\n`, stderr: '' } })
const DENY = (rule: string, n: number, extra: Record<string, unknown> = {}) => ({
  v: 1, at: `2026-11-14T10:0${n}:00Z`, rule, kind: 'deny', session: 'S1', agent: null, ...extra,
})

type Env = Parameters<Parameters<typeof test>[1]>
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }

function makeWorld() {
  return {
    settings: SETTINGS() as string,
    files: FILES(),
    denies: ok('[]') as unknown,
    setMod: (argv: string[]): unknown => ok(`set mods.${argv[3].replace(/-/g, '_')}.enabled ${argv[4]}`),
    calls: [] as { script: string; args: string[] }[],
    reads: [] as string[],
    writes: 0,
    toasts: [] as string[],
    opened: [] as string[],
  }
}
type World = ReturnType<typeof makeWorld>

const norm = (p: unknown) => String(p).replace(/\\/g, '/')

async function boot($: Env[0], on: Env[1], w: World) {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:30:00Z') })
  on('session.root', () => ({ value: '/work' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('fs.list', ((_: unknown, e: { path: string }) => {
    if (!norm(e.path).endsWith('hooks/manifests')) return { value: [] }
    return { value: Object.keys(w.files).map(name => ({ name, kind: 'file', size: 400, mtimeMs: 1 })) }
  }) as never)
  on('fs.read', ((_: unknown, e: { path: string }) => {
    const p = norm(e.path)
    w.reads.push(p)
    const name = p.split('/').pop() as string
    if (p.includes('/hooks/manifests/') && name in w.files) return { value: JSON.stringify(w.files[name]) }
    if (p.endsWith('.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: '0.40.0' }) }
    return { deny: 'no such file' }
  }) as never)
  on('fs.write', (() => {
    w.writes++
    return { deny: 'no write' }
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ((_: unknown, e: { text: string }) => (w.toasts.push(e.text), { value: undefined })) as never)
  on('ui.open', ((_: unknown, e: { id: string }) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.run', () => ({ text: 'engine' }))
  on('process.run', ((_: unknown, e: Call) => {
    const script = norm(e.argv[1]).split('/').pop() ?? ''
    w.calls.push({ script, args: e.argv.slice(2) })
    if (script === 'settings.mjs') {
      if (e.argv[2] === 'set-mod') {
        const r = w.setMod(e.argv)
        // A seen write is what flips the flag the shell reads next.
        if (e.argv[3] === 'switchboard' && e.argv[4] === 'seen') w.settings = SETTINGS(true)
        return r
      }
      return ok(w.settings)
    }
    if (script === 'hook-check.mjs') return typeof w.denies === 'function' ? w.denies() : w.denies
    if (script === 'run-state.mjs') return ok(JSON.stringify({ slug: null, view: null }))
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
    requestId: 'aico-mods',
    surface: 'terminal',
    props: { title: 'aico mods', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
}

type Ui = Awaited<ReturnType<Env[0]['ui']['mount']>>
async function lines(ui: Ui) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
}
async function rowButton(ui: Ui, word: string) {
  const b = (await ui.findAll({ type: 'Button' })).find(x => String(x.text).includes(word))
  expect(b, `a row button naming ${word}`).toBeDefined()
  return b as { key?: string; text?: string }
}
const all = async (ui: Ui) => [...(await lines(ui)), ...(await ui.findAll({ type: 'Button' })).map(b => String(b.text))].join('\n')
const setModCalls = (w: World) => w.calls.filter(c => c.script === 'settings.mjs' && c.args[0] === 'set-mod')

async function open($: Env[0], w: World) {
  await $.command.run({ command: 'aico-mods', args: '' } as never)
  expect(w.opened).toContain('aico-mods')
  return $.ui.mount(pane())
}

test('AC14/AC15: one row per manifest, guards first and marked LOCKED ON, savers after, no row for the switchboard itself', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await open($, w)
  const text = await all(ui)
  const order = ['GUARDS', 'cap guard', 'git-add guard', 'SAVERS', 'Cache clock', 'Savings pane', 'RECENT DENIES']
  let at = -1
  for (const part of order) {
    const i = text.indexOf(part, at + 1)
    expect(i, `${part} after ${at}`).toBeGreaterThan(at)
    at = i
  }
  expect(text.match(/LOCKED ON/g)?.length).toBe(2)
  expect(text).not.toContain('Switchboard')
  await ui.unmount()
})

test('AC15: a saver row shows its settings value, ON and OFF', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS(true, false)
  await boot($, on, w)
  const ui = await open($, w)
  expect(String((await rowButton(ui, 'Cache clock')).text)).toMatch(/OFF/)
  expect(String((await rowButton(ui, 'Savings pane')).text)).toMatch(/\bON\b/)
  await ui.unmount()
})

test('AC15: pressing a locked guard row runs nothing, writes nothing and says it is locked on', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await open($, w)
  const before = setModCalls(w).length
  await ui.press({ key: (await rowButton(ui, 'cap guard')).key as string })
  expect(setModCalls(w).length).toBe(before)
  expect(w.writes).toBe(0)
  expect(await all(ui)).toContain('cap is locked on and cannot be changed here.')
  expect(String((await rowButton(ui, 'cap guard')).text)).toContain('LOCKED ON')
  await ui.unmount()
})

test('toggle: pressing a saver runs set-mod with separate arguments, the row shows OFF (pending) and the message line says when it applies', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await open($, w)
  await ui.press({ key: (await rowButton(ui, 'Cache clock')).key as string })
  const calls = setModCalls(w).filter(c => c.args[1] !== 'switchboard')
  expect(calls.map(c => c.args)).toEqual([['set-mod', 'cache-tax', 'off']])
  expect(String((await rowButton(ui, 'Cache clock')).text)).toContain('OFF (pending)')
  expect(await all(ui)).toContain('cache-tax set OFF. Applies when the next task step starts.')
  await ui.unmount()
})

test('R-15: a project-level refusal shows on the message line and the row keeps its value', async ($, on) => {
  const w = makeWorld()
  w.setMod = () => ({ value: { exitCode: 2, stdout: 'refused: cache-tax is set in .company/settings.json\r\n', stderr: '' } })
  await boot($, on, w)
  const ui = await open($, w)
  const before = String((await rowButton(ui, 'Cache clock')).text)
  await ui.press({ key: (await rowButton(ui, 'Cache clock')).key as string })
  const text = await all(ui)
  expect(text).toContain('refused: cache-tax is set in .company/settings.json')
  const after = String((await rowButton(ui, 'Cache clock')).text)
  expect(after).toMatch(/\bON\b/)
  expect(after).not.toContain('pending')
  expect(after).toBe(before)
  await ui.unmount()
})

test('a set-mod that cannot run or answers nothing readable leaves the row alone and says so, no raw output', async ($, on) => {
  const w = makeWorld()
  w.setMod = () => ({ value: { exitCode: 0, stdout: 'boom \u001b[31m secret-token', stderr: '' } })
  await boot($, on, w)
  const ui = await open($, w)
  await ui.press({ key: (await rowButton(ui, 'Cache clock')).key as string })
  const text = await all(ui)
  expect(text).not.toContain('secret-token')
  expect(String((await rowButton(ui, 'Cache clock')).text)).not.toContain('pending')
  await ui.unmount()
})

test('hostile manifest title is shown as plain text: no escape or bidi characters, cut to 60', async ($, on) => {
  const w = makeWorld()
  w.files['cache-tax.json'] = SAVER('cache-tax', 'Cache\u001b[2J clock\u202E<Box>x</Box>')
  await boot($, on, w)
  const ui = await open($, w)
  const text = await all(ui)
  expect(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)).toBe(false)
  expect(text).toContain('Cache')
  await ui.unmount()
})

test('an invalid manifest is not drawn as a row; the others still are', async ($, on) => {
  const w = makeWorld()
  w.files['dotenv.json'] = { ...GUARD('dotenv', 'dotenv.M-SEC1'), lock: false, extra: 1 }
  await boot($, on, w)
  const ui = await open($, w)
  const text = await all(ui)
  expect(text).not.toContain('dotenv')
  expect(text).toContain('cap guard')
  await ui.unmount()
})

test('RECENT DENIES: none -> "No denies this session."', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await open($, w)
  expect(await all(ui)).toContain('No denies this session.')
  const call = w.calls.find(c => c.script === 'hook-check.mjs')
  expect(call?.args.slice(0, 2)).toEqual(['denies', '--session'])
  expect(String(call?.args[2]).length).toBeGreaterThan(0)
  expect(call?.args[3]).toBe('--json')
  await ui.unmount()
})

test('RECENT DENIES: one deny reads rule, who and time', async ($, on) => {
  const w = makeWorld()
  w.denies = ok(JSON.stringify([DENY('git-add.M-SEC1', 2)]))
  await boot($, on, w)
  const ui = await open($, w)
  const text = await all(ui)
  expect(text).toMatch(/git-add\.M-SEC1, main chat, \d\d:\d\d/)
  expect(text).not.toContain('No denies this session.')
  await ui.unmount()
})

test('RECENT DENIES: seven rows show the newest five only', async ($, on) => {
  const w = makeWorld()
  w.denies = ok(JSON.stringify([1, 2, 3, 4, 5, 6, 7].map(n => DENY(`r${n}.M1`, n))))
  await boot($, on, w)
  const ui = await open($, w)
  const text = await all(ui)
  expect(text.match(/r\d\.M1, /g)?.length).toBe(5)
  expect(text).toContain('r7.M1')
  expect(text).not.toContain('r1.M1')
  expect(text).not.toContain('r2.M1')
  await ui.unmount()
})

test('RECENT DENIES: hostile rule text is escaped plain text; a failing hook-check shows the empty line, never raw output', async ($, on) => {
  const w = makeWorld()
  w.denies = ok(JSON.stringify([DENY('x\u001b[2J\u202E<Box>' + 'y'.repeat(300), 3)]))
  await boot($, on, w)
  let ui = await open($, w)
  let text = await all(ui)
  expect(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)).toBe(false)
  expect(text).not.toContain('y'.repeat(150))
  await ui.unmount()

  w.denies = { value: { exitCode: 2, stdout: 'Traceback secret-path /home/x', stderr: 'boom' } }
  ui = await $.ui.mount(pane())
  text = await all(ui)
  expect(text).not.toContain('secret-path')
  expect(text).not.toContain('Traceback')
  await ui.unmount()
})

test('discovery: while seen is false one toast names aico-mods; opening runs `set-mod switchboard seen` once; later sessions and opens stay quiet', async ($, on) => {
  const w = makeWorld()
  w.settings = SETTINGS(false)
  const clock = await boot($, on, w)
  const named = () => w.toasts.filter(t => t.includes('aico-mods'))
  expect(named().length).toBe(1)
  expect(setModCalls(w).filter(c => c.args[1] === 'switchboard')).toEqual([])
  const ui = await open($, w)
  expect(setModCalls(w).filter(c => c.args[1] === 'switchboard').map(c => c.args)).toEqual([['set-mod', 'switchboard', 'seen']])
  await ui.unmount()
  const ui2 = await open($, w)
  await ui2.unmount()
  expect(setModCalls(w).filter(c => c.args[1] === 'switchboard').length).toBe(1)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(2500)
  expect(named().length).toBe(1)
})

test('discovery: with seen true there is no toast naming aico-mods and no seen write', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  expect(w.toasts.filter(t => t.includes('aico-mods'))).toEqual([])
  const ui = await open($, w)
  expect(setModCalls(w).filter(c => c.args[1] === 'switchboard')).toEqual([])
  await ui.unmount()
})

test('AC23: the pane only runs settings.mjs, hook-check.mjs and ledger.mjs, never writes a file and never reads a switches.json', async ($, on) => {
  const w = makeWorld()
  await boot($, on, w)
  const ui = await open($, w)
  await ui.press({ key: (await rowButton(ui, 'Savings pane')).key as string })
  await ui.unmount()
  expect(w.writes).toBe(0)
  expect(w.reads.some(p => /switches\.json/i.test(p))).toBe(false)
  const allowed = new Set(['settings.mjs', 'hook-check.mjs', 'ledger.mjs', 'run-state.mjs', 'lead-handover.mjs'])
  expect(w.calls.filter(c => !allowed.has(c.script))).toEqual([])
})

test('settings unreadable: savers say UNKNOWN and cannot change, guards stay LOCKED ON', async ($, on) => {
  const w = makeWorld()
  w.settings = 'not json'
  await boot($, on, w)
  const ui = await open($, w)
  expect(String((await rowButton(ui, 'Cache clock')).text)).toMatch(/UNKNOWN/)
  expect(String((await rowButton(ui, 'cap guard')).text)).toContain('LOCKED ON')
  const before = setModCalls(w).length
  await ui.press({ key: (await rowButton(ui, 'Cache clock')).key as string })
  expect(setModCalls(w).length).toBe(before)
  expect(await all(ui)).toContain('Savers cannot change now.')
  await ui.unmount()
})
