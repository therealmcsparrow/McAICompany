import { expect, mock, test } from 'claude-code/testing'

import { runStateVerdict } from '../fresh-step'
import { resetScriptCaller, runScript } from '../shared/run-script'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/work'
const REASON = 'aico: Steps are never resumed; dispatch a fresh Step (next NN) with the old Handoff as input (pipeline §2)'
const UNREADABLE = ' (run state unreadable)'
const ACTIVE = JSON.stringify({ slug: 'run-one', view: null })
const IDLE = JSON.stringify({ slug: null, view: null })
const DIR = { kind: 'dir', size: 0, mtimeMs: 1, isLink: false }

type Env = Parameters<Parameters<typeof test>[1]>
type Answer = { exitCode: number; stdout: string } | 'reject' | 'typeError' | 'hang' | 'noProcess'
type Opts = { work?: boolean; answer?: Answer; rootFails?: boolean }
type Call = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Sent = { isDelivered: boolean; reason?: string }
type Spawned = { agentId?: string; deny?: string }

async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], o: Opts = {}) {
  const clock = mock.clock(on)
  const calls: Call[] = []
  const delivered: unknown[] = []
  const spawned: unknown[] = []
  const answer: Answer = o.answer ?? { exitCode: 0, stdout: ACTIVE }
  on('session.root', () => {
    if (o.rootFails) throw new Error('no root')
    return { value: ROOT }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('state.get', (() => ({ value: { value: undefined, version: 0 } })) as never)
  on('state.set', (() => ({ value: { isSet: true, version: 1 } })) as never)
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('fs.stat', ((_: unknown, raw: { path: string }) => {
    const path = raw.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    if (path === `${ROOT}/.company/work` && o.work !== false) return { value: DIR }
    throw new Error('ENOENT')
  }) as never)
  on('session.send', (() => (delivered.push(1), { isDelivered: true as const })) as never)
  on('agent.spawn', (() => (spawned.push(1), { model: 'm', agentId: 'a1' })) as never)
  on('process.run', ((_: unknown, e: Call) => {
    if (e.argv[1].endsWith('settings.mjs')) return { value: { exitCode: 0, stdout: '{"revision":1,"roles":{},"mods":{}}', stderr: '' } }
    if (!e.argv[1].endsWith('run-state.mjs') || e.argv[2] !== 'active') return { value: { exitCode: 0, stdout: IDLE, stderr: '' } }
    calls.push(e)
    if (answer === 'noProcess') return { deny: 'no process here' }
    if (answer === 'reject') throw new Error('spawn failed')
    if (answer === 'typeError') return Promise.reject(new TypeError('process is not available'))
    if (answer === 'hang') return new Promise(() => undefined)
    return { value: { exitCode: answer.exitCode, stdout: answer.stdout, stderr: '' } }
  }) as never)
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  await clock.advance(0)
  calls.length = 0
  const send = (origin?: unknown) => $.session.send({ to: 'a1', text: 'go on', ...(origin === undefined ? {} : { origin }) } as never) as Promise<Sent>
  const model = () => send({ kind: 'model' })
  const spawn = (over: object = {}) =>
    $.agent.spawn({ prompt: 'x', description: 'd', subagentType: 'general-purpose', background: false, fork: false, tool_use_id: 't', ...over } as never) as Promise<Spawned>
  const resume = () => spawn({ resume: { agentId: 'a1' } })
  return { clock, calls, delivered, spawned, send, model, spawn, resume }
}

for (const surface of SURFACES) {
  test(`a model send in an active run is not delivered with the fixed reason (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    const r = await t.model()
    expect(r.isDelivered).toBe(false)
    expect(r.reason).toBe(REASON)
    expect(t.delivered.length).toBe(0)
    expect(t.calls.length).toBe(1)
    expect(t.calls[0].argv.slice(2)).toEqual(['active', '--json'])
    expect(t.calls[0].argv[1].endsWith('/scripts/run-state.mjs')).toBe(true)
    expect(t.calls[0].init).toEqual({ cwd: ROOT, timeoutMs: 1000 })
  })

  test(`a resumed spawn in an active run is denied with the same reason (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    const r = await t.resume()
    expect(r.deny).toBe(REASON)
    expect(t.spawned.length).toBe(0)
  })

  test(`a spawn without resume goes on with no call (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    const r = await t.spawn()
    expect(r.agentId).toBe('a1')
    expect(t.calls.length).toBe(0)
  })

  for (const [name, origin] of [['a plugin', { kind: 'plugin', plugin: 'other' }], ['no', undefined]] as const) {
    test(`a send with ${name} origin passes with no call (${surface})`, async ($, on) => {
      const t = await boot($, on, surface)
      const r = await t.send(origin)
      expect(r.isDelivered).toBe(true)
      expect(t.calls.length).toBe(0)
    })
  }

  test(`no .company/work passes with no call (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { work: false })
    expect((await t.model()).isDelivered).toBe(true)
    expect((await t.resume()).agentId).toBe('a1')
    expect(t.calls.length).toBe(0)
  })

  test(`slug null passes (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { answer: { exitCode: 0, stdout: IDLE } })
    expect((await t.model()).isDelivered).toBe(true)
    expect((await t.resume()).agentId).toBe('a1')
    expect(t.calls.length).toBe(2)
  })

  const FAILS: [string, Answer][] = [
    ['non-zero exit', { exitCode: 1, stdout: ACTIVE }],
    ['invalid JSON', { exitCode: 0, stdout: '{bad' }],
    ['a guard failure', { exitCode: 0, stdout: '{"slug":"../x"}' }],
    ['a rejected call', 'reject'],
    ['a TypeError rejection', 'typeError'],
    ['a hung call', 'hang'],
    ['a surface that refuses the process call', 'noProcess'],
  ]
  for (const [name, answer] of FAILS) {
    test(`${name} refuses with the unreadable suffix (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { answer })
      const pending = Promise.all([t.model(), t.resume()])
      await t.clock.advance(5000)
      const [sent, resumed] = await pending
      expect(sent.isDelivered).toBe(false)
      expect(sent.reason).toBe(REASON + UNREADABLE)
      expect(resumed.deny).toBe(REASON + UNREADABLE)
      expect(t.delivered.length).toBe(0)
      expect(t.spawned.length).toBe(0)
    })
  }

  test(`a failing session root refuses with the unreadable suffix (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rootFails: true })
    const r = await t.model()
    expect(r.isDelivered).toBe(false)
    expect(r.reason).toBe(REASON + UNREADABLE)
  })
}

// Three timed-out calls through the shared caller, from another mod's script, until it gives up.
async function breakSharedCaller() {
  resetScriptCaller()
  let processCalls = 0
  const other = {
    session: { root: async () => ROOT },
    plugin: { root: '/plugin' },
    clock: { sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))) },
    process: { run: () => (processCalls++, new Promise(() => undefined)) },
  }
  const guard = (value: unknown) => value
  for (let i = 0; i < 3; i++) expect(await runScript(other as never, 'ledger', ['report', 'x'], 1000, guard)).toEqual({ ok: false, reason: 'timeout' })
  expect(await runScript(other as never, 'ledger', ['report', 'x'], 1000, guard)).toEqual({ ok: false, reason: 'unavailable' })
  expect(processCalls).toBe(3)
}

test('timed-out script calls elsewhere never change the answer of this mod', async ($, on) => {
  const t = await boot($, on, 'terminal')
  await breakSharedCaller()
  t.calls.length = 0
  const r = await t.model()
  expect(r.isDelivered).toBe(false)
  expect(r.reason).toBe(REASON)
  expect(t.calls.length).toBe(1)
})

test('the same given-up shared caller still delivers when no run is active', async ($, on) => {
  const t = await boot($, on, 'terminal', { answer: { exitCode: 0, stdout: IDLE } })
  await breakSharedCaller()
  t.calls.length = 0
  expect((await t.model()).isDelivered).toBe(true)
  expect((await t.resume()).agentId).toBe('a1')
  expect(t.calls.length).toBe(2)
})

test('a surface where the process call throws a TypeError at the call passes', async () => {
  const seen: string[] = []
  const $ = {
    session: { root: async () => ROOT },
    fs: { stat: async (path: string) => (seen.push(path), DIR) },
    plugin: { root: '/plugin' },
    clock: { sleep: () => new Promise(() => undefined) },
  }
  expect(await runStateVerdict($ as never)).toBe('pass')
  expect(seen).toEqual([`${ROOT}/.company/work`])
})

test('a non-TypeError throw at the process call is unreadable', async () => {
  const $ = {
    session: { root: async () => ROOT },
    fs: { stat: async () => DIR },
    plugin: { root: '/plugin' },
    clock: { sleep: () => new Promise(() => undefined) },
    process: {
      run: () => {
        throw new Error('boom')
      },
    },
  }
  expect(await runStateVerdict($ as never)).toBe('unreadable')
})
