import { expect, mock, test } from 'claude-code/testing'

import { readSettings, refreshSettings } from '../shared/settings'
import { TIMEOUT_MS, resetScriptCaller, runScript } from '../shared/run-script'
import { isViewSurface } from '../shared/surface'

const MODS = {
  savvy: { enabled: false, pane: 'command' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
}
const GOOD = JSON.stringify({ revision: 1, roles: { architect: { name: 'Ava' } }, mods: MODS })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })

type Write = { plugin: string; key: string; value: { shape: string; value: { known: boolean; mods: typeof MODS; roles: Record<string, string> } } }
type Run = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Env = Parameters<Parameters<typeof test>[1]>
const SURFACES = ['terminal', 'desktop'] as const

// Starts a session with `answer` standing for `$.process.run`; returns what the shell wrote to state.
async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], answer: (e: Run) => unknown) {
  const clock = mock.clock(on)
  const writes: Write[] = []
  on('session.root', () => ({ value: '/work' }))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    writes.push(e as unknown as Write)
    return { value: { isSet: true, version: 1 } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', ((_: unknown, e: Run) => answer(e)) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(0)
  return writes.filter(w => w.key === 'settings').map(w => w.value)
}

for (const surface of SURFACES) {
  test(`settings fill from a script answer with CRLF (${surface})`, async ($, on) => {
    const writes = await boot($, on, surface, () => ok(GOOD + '\r\n'))
    const last = writes[writes.length - 1]
    expect(last.shape).toBe('v1')
    expect(last.value.known).toBe(true)
    expect(last.value.mods.savvy.enabled).toBe(false)
    expect(last.value.roles.architect).toBe('Ava')
  })
}

test('the script is called with an argument array, the session root and a timeout', async ($, on) => {
  const seen: Run[] = []
  await boot($, on, 'terminal', e => {
    seen.push(e)
    return ok(GOOD)
  })
  expect(seen[0].argv[0]).toBe('node')
  expect(seen[0].argv.slice(2)).toEqual(['get'])
  expect(seen[0].argv[1].endsWith('/scripts/settings.mjs')).toBe(true)
  expect(seen[0].init.cwd).toBe('/work')
  expect(seen[0].init.timeoutMs).toBe(TIMEOUT_MS.get)
})

const FAILURES: [string, unknown][] = [
  ['bad JSON', ok('{bad')],
  ['over-size output', ok('x'.repeat(300000))],
  ['exit code 2', { value: { exitCode: 2, stdout: GOOD, stderr: '' } }],
  ['truncated output', { value: { exitCode: 0, stdout: GOOD, stderr: '', isStdoutTruncated: true } }],
  ['a value outside the allow-list', ok(JSON.stringify({ roles: {}, mods: { ...MODS, reflect: { ...MODS.reflect, mode: 'sudo' } } }))],
  ['a rejection', { deny: 'no process here' }],
]
for (const [name, answer] of FAILURES) {
  for (const surface of SURFACES) {
    test(`${name} leaves the defaults and known false (${surface})`, async ($, on) => {
      const writes = await boot($, on, surface, () => answer)
      const last = writes[writes.length - 1].value
      expect(last.known).toBe(false)
      expect(last.mods.savvy.enabled).toBe(true)
      expect(last.mods.blast_radius.contract).toBe('warn')
    })
  }
}

test('a surface that keeps rejecting is not called again', async (_, on) => {
  mock.clock(on)
  let calls = 0
  const fake = {
    plugin: { root: '/p' },
    session: { root: async () => '/work' },
    process: { run: async () => { calls++; throw new Error('rejected') } },
    clock: { sleep: () => new Promise(() => undefined) },
  }
  resetScriptCaller()
  for (let i = 0; i < 6; i++) expect((await runScript(fake as never, 'settings', ['get'], 1000, () => ({}))).ok).toBe(false)
  expect(calls).toBe(3)
})

test('a call that never answers times out on the clock', async (_, on) => {
  const clock = mock.clock(on)
  const fake = {
    plugin: { root: '/p' },
    session: { root: async () => '/work' },
    process: { run: () => new Promise(() => undefined) },
    clock: { sleep: (ms: number) => clock.sleep(ms) },
  }
  resetScriptCaller()
  const pending = runScript(fake as never, 'settings', ['get'], 1000, () => ({}))
  await clock.advance(1600)
  const r = await pending
  expect(r.ok === false && r.reason).toBe('timeout')
})

test('a surface without $.process is unknown, never a throw', async (_, on) => {
  resetScriptCaller()
  const bare = { plugin: { root: '/p' }, session: { root: async () => '/work' }, clock: { sleep: async () => undefined } }
  const r = await runScript(bare as never, 'settings', ['get'], 1000, () => ({}))
  expect(r.ok === false && r.reason).toBe('unavailable')
  const again = await runScript(bare as never, 'settings', ['get'], 1000, () => ({}))
  expect(again.ok === false && again.reason).toBe('unavailable')
})

test('session.start does not wait for a script', async ($, on) => {
  on('session.root', () => ({ value: '/work' }))
  on('process.run', () => new Promise(() => undefined))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const started = await $.session.start({ cwd: '/work', surface, isInteractive: true })
    expect(started).toBeTruthy()
  }
})

test('only the terminal and the desktop draw views', () => {
  expect(isViewSurface('terminal')).toBe(true)
  expect(isViewSurface('desktop')).toBe(true)
  expect(isViewSurface('vscode')).toBe(false)
  expect(isViewSurface('mobile')).toBe(false)
  expect(isViewSurface(null)).toBe(false)
  expect(isViewSurface(undefined)).toBe(false)
})

async function bootWithOutputs($: Env[0], on: Env[1], answer: (e: Run) => unknown) {
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  await boot($, on, 'terminal', answer)
  return { toasts, statuses }
}

test('session start shows one toast that lists the mods that are on, and the idle status part', async ($, on) => {
  const out = await bootWithOutputs($, on, () => ok(GOOD))
  expect(out.toasts).toEqual(['aico mods ready: Cache Tax, Reflect, Blast Radius'])
  expect(out.statuses[0]).toBe('aico idle')
})

test('a settings call that fails still toasts, and says the settings are unknown', async ($, on) => {
  const out = await bootWithOutputs($, on, () => ({ deny: 'no process here' }))
  expect(out.toasts).toHaveLength(1)
  expect(out.toasts[0]).toMatch(/^aico mods ready \(settings unknown\): /)
})

test('a refused toast does not break the session start', async ($, on) => {
  on('ui.toast', () => ({ deny: 'no toast' }))
  on('ui.status', () => ({ deny: 'no status' }))
  const writes = await boot($, on, 'terminal', () => ok(GOOD))
  expect(writes[writes.length - 1].value.known).toBe(true)
})
