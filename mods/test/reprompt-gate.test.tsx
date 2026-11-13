import { expect, mock, test } from 'claude-code/testing'

const MODS = {
  savvy: { enabled: true, pane: 'command' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
}
const SETTINGS = JSON.stringify({ revision: 1, roles: {}, mods: MODS })
const OFF = JSON.stringify({ revision: 1, roles: {}, mods: Object.fromEntries(Object.entries(MODS).map(([k, v]) => [k, { ...v, enabled: false }])) })
const ACTIVE = JSON.stringify({ slug: null, view: null })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })

const ROOT = '/work'
const SLUG = 'reprompt-20260101-0930'
const RUN = `${ROOT}/.company/work/${SLUG}`
const DISPATCH = `Name: Lynn\nOutput: .company/work/${SLUG}/01-reprompter.md\nGoal: x\n`
const SURFACES = ['terminal', 'desktop'] as const
const DENY_BAD = 'aico reprompt gate: bad reprompter dispatch'
const DENY_ARM = 'aico reprompt gate: cannot arm the gate; reprompt refused'
const DENY_FAILED = 'aico reprompt gate failed; reprompt refused'
const DENY_NOT_STARTED = 'aico reprompt gate: this reprompter was not started through the gate'
const DENY_UNKNOWN = 'aico reprompt gate: unknown agent during a reprompt run; refused'
const FILE = { kind: 'file', size: 10, mtimeMs: 1, isLink: false }
const TTL = 1_800_000
// Advancing TTL of fake time fires every mod's 2 s tick about 900 times, which is real CPU work; those tests get headroom under load.
const SLOW_MS = 30_000
const OTHER_SLUG = 'reprompt-20260102-1000'

type Env = Parameters<Parameters<typeof test>[1]>
type Run = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Opts = {
  arm?: unknown
  rows?: unknown[] | 'reject'
  ids?: (string | undefined)[]
  spawnThrows?: boolean
  checkThrows?: boolean
  bottom?: 'allow' | 'ask'
  noProcess?: boolean
  modsOff?: boolean
  marker?: 'file' | 'link' | 'dir' | 'gone'
  runState?: string | 'link' | 'big' | 'gone' | 'unreadable'
}

async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], o: Opts = {}) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const logs: string[] = []
  const arms: Run[] = []
  const bottom = { spawns: 0, checks: 0, lists: 0 }
  const fsCalls: string[] = []
  const world = { marker: o.marker ?? 'file', runState: o.runState ?? '{"ev":"start"}\n' }
  const ids = [...(o.ids ?? [])]
  const flags = { rootFails: false }
  on('session.root', () => {
    if (flags.rootFails) throw new Error('no root')
    return { value: ROOT }
  })
  const kept = new Map<string, unknown>()
  on('state.get', ((_: unknown, e: { plugin: string; key: string }) => ({ value: { value: kept.get(`${e.plugin}/${e.key}`), version: 0 } })) as never)
  on('state.set', ((_: unknown, e: { plugin: string; key: string; value: unknown }) => {
    kept.set(`${e.plugin}/${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => (/^aico mods ready/.test(e.text) || toasts.push(e.text), { value: undefined }))
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }))
  on('tool.check', (() => {
    bottom.checks++
    if (o.checkThrows) throw new Error('boom')
    return { decision: o.bottom ?? 'allow' }
  }) as never)
  on('agent.spawn', (() => {
    bottom.spawns++
    if (o.spawnThrows) throw new Error('boom')
    return { model: 'm', agentId: ids.length > 0 ? ids.shift() : 'r1' }
  }) as never)
  on('agent.list', (() => {
    bottom.lists++
    if (o.rows === 'reject') throw new Error('no list')
    return { value: o.rows ?? [] }
  }) as never)
  // The engine hands paths over in the platform's own form; the test compares them as POSIX paths.
  const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('fs.stat', ((_: unknown, raw: { path: string }) => {
    const e = { path: posix(raw.path) }
    // The shell reads the plugin's own manifest at session start; that is not a gate read.
    if (e.path.endsWith('/.claude-plugin/plugin.json')) throw new Error('ENOENT')
    fsCalls.push(`stat ${e.path}`)
    if (e.path.startsWith(`${RUN}/.gate-`)) {
      if (world.marker === 'gone') throw new Error('ENOENT')
      return { value: { ...FILE, isLink: world.marker === 'link', kind: world.marker === 'dir' ? 'dir' : 'file' } }
    }
    if (e.path === `${RUN}/run-state.jsonl`) {
      if (world.runState === 'gone') throw new Error('ENOENT')
      return { value: { ...FILE, isLink: world.runState === 'link', size: world.runState === 'big' ? 65537 : 10 } }
    }
    if (e.path.startsWith(`${ROOT}/.company/work/${OTHER_SLUG}/.gate-`)) return { value: FILE }
    throw new Error('ENOENT')
  }) as never)
  on('fs.read', ((_: unknown, raw: { path: string }) => {
    fsCalls.push(`read ${posix(raw.path)}`)
    if (world.runState === 'unreadable') throw new Error('EACCES')
    return { value: world.runState }
  }) as never)
  on('process.run', ((_: unknown, e: Run) => {
    if (o.noProcess) return { deny: 'no process here' }
    if (e.argv[1].endsWith('settings.mjs')) return ok(o.modsOff ? OFF : SETTINGS)
    if (e.argv[1].endsWith('run-state.mjs')) return ok(ACTIVE)
    if (e.argv[1].endsWith('reprompt-check.mjs')) {
      arms.push(e)
      if (o.arm === 'reject') return { deny: 'cannot run' }
      return (o.arm ?? ok(`{"armed":"${e.argv[4]}"}\n`)) as never
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  }) as never)
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  await clock.advance(0)
  const spawn = (over: object = {}) =>
    $.agent.spawn({ prompt: DISPATCH, description: 'd', subagentType: 'aico:reprompter', background: false, fork: false, tool_use_id: 't', ...over } as never)
  const check = (agentId: string | undefined, tool: string, input: object, extra: object = {}) =>
    $.tool.check({ tool, input, agentId, ...extra } as never)
  const rejected = async (run: () => Promise<unknown>) => {
    try {
      await run()
      return false
    } catch {
      return true
    }
  }
  return { toasts, logs, arms, bottom, flags, spawn, check, rejected, clock, fsCalls, world }
}

for (const surface of SURFACES) {
  test(`a well-formed reprompter spawn is armed once, then recorded (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'] })
    const r = await t.spawn()
    expect(r.agentId).toBe('rp1')
    expect(t.arms.length).toBe(1)
    expect(t.arms[0].argv.slice(2)).toEqual(['arm', SLUG, '01'])
    expect(t.arms[0].argv[1].endsWith('/scripts/reprompt-check.mjs')).toBe(true)
    expect(t.arms[0].init.cwd).toBe(ROOT)
    expect(t.arms[0].init.timeoutMs).toBe(5000)
    expect(t.bottom.spawns).toBe(1)
    expect(t.bottom.lists).toBe(0)
  })

  test(`the bare reprompter name is gated the same way (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'] })
    await t.spawn({ subagentType: 'reprompter' })
    expect(t.arms.length).toBe(1)
    expect((await t.check('rp1', 'Bash', { command: 'ls' })).decision).toBe('deny')
  })

  const BAD_DISPATCH: [string, object][] = [
    ['no Output line', { prompt: 'Goal: x\n' }],
    ['an Output line for another Role', { prompt: `Output: .company/work/${SLUG}/01-editor.md\n` }],
    ['two Output lines', { prompt: `${DISPATCH}Output: .company/work/${SLUG}/02-reprompter.md\n` }],
    ['an Output line with a trailing path', { prompt: `Output: .company/work/${SLUG}/01-reprompter.md/../../x\n` }],
    ['a foreign slug', { prompt: 'Output: .company/work/mine/01-reprompter.md\n' }],
    ['a CRLF line', { prompt: `Output: .company/work/${SLUG}/01-reprompter.md\r\n` }],
    ['a cwd elsewhere', { cwd: '/elsewhere' }],
    ['a cwd below the root', { cwd: `${ROOT}/sub` }],
    ['a fork', { fork: true }],
    ['a teammate', { isTeammate: true }],
  ]
  for (const [name, over] of BAD_DISPATCH) {
    test(`a reprompter spawn with ${name} is refused before anything runs (${surface})`, async ($, on) => {
      const t = await boot($, on, surface)
      const r = await t.spawn(over)
      expect(r.deny).toBe(DENY_BAD)
      expect(t.arms.length).toBe(0)
      expect(t.bottom.spawns).toBe(0)
    })
  }

  test(`the cwd equal to the session root is accepted (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'] })
    expect((await t.spawn({ cwd: ROOT })).agentId).toBe('rp1')
  })

  const BAD_ARM: [string, unknown][] = [
    ['exit 3', { value: { exitCode: 3, stdout: '{"refused":"refused: gate already armed"}\n', stderr: '' } }],
    ['exit 0 with another number', ok('{"armed":"02"}\n')],
    ['exit 0 with extra keys', ok('{"armed":"01","x":1}\n')],
    ['exit 0 with bad JSON', ok('{bad')],
    ['exit 0 with no output', ok('')],
    ['a rejected script call', 'reject'],
  ]
  for (const [name, arm] of BAD_ARM) {
    test(`an arm failure (${name}) refuses the spawn and starts nothing (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { arm })
      const r = await t.spawn()
      expect(r.deny).toBe(DENY_ARM)
      expect(t.bottom.spawns).toBe(0)
    })
  }

  test(`a missing $.process refuses the spawn (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { noProcess: true })
    expect((await t.spawn()).deny).toBe(DENY_ARM)
    expect(t.bottom.spawns).toBe(0)
  })

  test(`a second spawn for the same dispatch is refused when the marker exists (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { arm: { value: { exitCode: 3, stdout: '{"refused":"x"}', stderr: '' } } })
    expect((await t.spawn()).deny).toBe(DENY_ARM)
  })

  test(`an error inside the gate refuses a reprompter spawn and leaves other Roles alone (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['ed1'] })
    t.flags.rootFails = true
    expect((await t.spawn()).deny).toBe(DENY_FAILED)
    expect(t.arms.length).toBe(0)
    expect(t.bottom.spawns).toBe(0)
    expect((await t.spawn({ subagentType: 'editor', prompt: 'x' })).agentId).toBe('ed1')
  })

  test(`Write and Read on the allow-list pass to the session rules, never answered allow (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'], bottom: 'ask' })
    await t.spawn()
    const calls: [string, object][] = [
      ['Write', { file_path: `${RUN}/prompt.md`, content: 'x' }],
      ['Write', { file_path: `${RUN}/01-reprompter.md`, content: 'x' }],
      ['Read', { file_path: `${RUN}/request.md` }],
      ['Read', { file_path: `${RUN}/answers-2.md` }],
      ['Read', { file_path: `${ROOT}/.company/project.md` }],
      ['Skill', { skill: 'aico:handoff' }],
    ]
    for (const [tool, input] of calls) {
      const r = await t.check('rp1', tool, input)
      expect(r.decision).toBe('ask')
    }
    expect(t.bottom.checks).toBe(calls.length)
    expect(t.toasts.length).toBe(0)
  })

  test(`a Read of the plugin PROFILE.md and the handoff skill passes (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'] })
    await t.spawn()
    const plugin = t.arms[0].argv[1].replace(/\/scripts\/reprompt-check\.mjs$/, '').replace(/\\/g, '/')
    expect((await t.check('rp1', 'Read', { file_path: `${plugin}/company/PROFILE.md` })).decision).toBe('allow')
    expect((await t.check('rp1', 'Read', { file_path: `${plugin}/skills/handoff/SKILL.md` })).decision).toBe('allow')
    expect((await t.check('rp1', 'Read', { file_path: `${plugin}/skills/writing/SKILL.md` })).decision).toBe('deny')
  })

  const REFUSED: [string, string, object][] = [
    ['Write', 'a stray file in the project', { file_path: `${ROOT}/node_modules/x.js`, content: 'x' }],
    ['Write', 'a shell profile', { file_path: '/home/me/.bashrc', content: 'x' }],
    ['Write', 'the marker', { file_path: `${RUN}/.gate-01`, content: '1\n' }],
    ['Write', 'another dispatch Handoff', { file_path: `${RUN}/02-reprompter.md`, content: 'x' }],
    ['Write', 'a stream name', { file_path: `${RUN}/prompt.md:x`, content: 'x' }],
    ['Write', 'a traversal', { file_path: `${RUN}/../prompt.md`, content: 'x' }],
    ['Write', 'no file_path', { content: 'x' }],
    ['Read', '.env', { file_path: `${ROOT}/.env` }],
    ['Read', 'the marker', { file_path: `${RUN}/.gate-01` }],
    ['Read', 'a home file', { file_path: '/home/me/.ssh/id_rsa' }],
    ['Skill', 'aico:writing', { skill: 'aico:writing' }],
    ['Skill', 'no skill', {}],
    ['Edit', 'the prompt', { file_path: `${RUN}/prompt.md`, old_string: 'a', new_string: 'b' }],
    ['MultiEdit', 'the prompt', { file_path: `${RUN}/prompt.md`, edits: [] }],
    ['NotebookEdit', 'a notebook', { notebook_path: `${RUN}/prompt.md`, new_source: 'x' }],
    ['Bash', 'a command', { command: 'echo x > ~/.bashrc' }],
    ['PowerShell', 'a command', { command: 'ls' }],
    ['Glob', 'a pattern', { pattern: '**/*' }],
    ['Grep', 'a pattern', { pattern: 'x' }],
    ['WebFetch', 'a url', { url: 'https://example.com' }],
    ['Agent', 'a nested agent', { prompt: 'x' }],
    ['mcp__srv__write', 'an MCP tool', { file_path: `${RUN}/prompt.md` }],
    ['mcp__srv__Write', 'an MCP look-alike', { file_path: `${RUN}/prompt.md` }],
  ]
  for (const [tool, what, input] of REFUSED) {
    test(`${tool} on ${what} is denied with a toast and never reaches the session rules (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { ids: ['rp1'] })
      await t.spawn()
      const r = await t.check('rp1', tool, input)
      expect(r.decision).toBe('deny')
      expect(r.reason).toMatch(/^aico reprompt gate: /)
      expect(r.reason).toContain(`${tool} refused`)
      expect(r.reason!.length < 200).toBe(true)
      expect(t.bottom.checks).toBe(0)
      expect(t.toasts.some(x => x.startsWith(`aico: reprompter ${tool} refused:`))).toBe(true)
      expect(t.logs.some(x => x.includes(tool))).toBe(true)
    })
  }

  test(`a hostile path is cleaned in the toast and the log (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'] })
    await t.spawn()
    await t.check('rp1', 'Write', { file_path: `/x\u001b[2J\n${'b'.repeat(500)}`, content: 'x' })
    const toast = t.toasts[0]
    expect(/[\u0000-\u001f]/.test(toast)).toBe(false)
    expect(toast.length <= 'aico: reprompter Write refused: '.length + 80).toBe(true)
    expect(t.logs.every(x => !/[\u0000-\u001f]/.test(x))).toBe(true)
  })

  test(`each reprompter is held to its own run folder (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1', 'rp2'] })
    await t.spawn()
    await t.spawn({ prompt: 'Output: .company/work/reprompt-20260102-1000/03-reprompter.md\n' })
    const other = `${ROOT}/.company/work/reprompt-20260102-1000`
    expect((await t.check('rp1', 'Write', { file_path: `${other}/prompt.md`, content: 'x' })).decision).toBe('deny')
    expect((await t.check('rp2', 'Write', { file_path: `${RUN}/prompt.md`, content: 'x' })).decision).toBe('deny')
    expect((await t.check('rp2', 'Write', { file_path: `${other}/03-reprompter.md`, content: 'x' })).decision).toBe('allow')
    expect((await t.check('rp1', 'Write', { file_path: `${RUN}/03-reprompter.md`, content: 'x' })).decision).toBe('deny')
  })

  test(`an unrecorded reprompter found in the list is denied, even for a read (${surface})`, async ($, on) => {
    const rows = [{ id: 'old', type: 'aico:reprompter', description: 'd', status: 'running' }]
    const t = await boot($, on, surface, { rows })
    for (const [tool, input] of [['Read', { file_path: `${ROOT}/.company/project.md` }], ['Write', { file_path: `${RUN}/prompt.md` }], ['Bash', { command: 'ls' }]] as const) {
      const r = await t.check('old', tool, input, { isReadOnly: true })
      expect(r.decision).toBe('deny')
      expect(r.reason).toBe(DENY_NOT_STARTED)
    }
    expect(t.bottom.checks).toBe(0)
  })

  test(`an unrecorded agent of another type in the list passes, and is remembered (${surface})`, async ($, on) => {
    const rows = [{ id: 'ed', type: 'editor', description: 'd', status: 'running' }]
    const t = await boot($, on, surface, { rows })
    expect((await t.check('ed', 'Bash', { command: 'ls' })).decision).toBe('allow')
    expect((await t.check('ed', 'Write', { file_path: '/anywhere' })).decision).toBe('allow')
    expect(t.bottom.lists).toBe(1)
  })

  test(`an agent the list does not know is denied while a run is armed, unless the call is read-only (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1'] })
    await t.spawn()
    const r = await t.check('ghost', 'Bash', { command: 'ls' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe(DENY_UNKNOWN)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
    expect((await t.check('ghost', 'Read', { file_path: '/x' }, { isReadOnly: true })).decision).toBe('allow')
  })

  test(`a rejected list is denied while a run is armed, unless the call is read-only (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: 'reject', ids: ['rp1'] })
    await t.spawn()
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
    expect((await t.check('ghost', 'Bash', { command: 'ls' })).decision).toBe('deny')
    expect((await t.check('ghost', 'Read', { file_path: '/x' }, { isReadOnly: true })).decision).toBe('allow')
  })

  for (const rows of [[], 'reject'] as const) {
    test(`an unknown agent passes when no run is armed, with no file read (list ${rows === 'reject' ? 'rejected' : 'empty'}, ${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { rows })
      expect((await t.check('ghost', 'Bash', { command: 'ls' })).decision).toBe('allow')
      expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
      expect(t.fsCalls.length).toBe(0)
      expect(t.toasts.length).toBe(0)
    })
  }

  test(`a marker on disk that no arm call made arms nothing (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], marker: 'file', runState: '{"ev":"start"}\n' })
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
    expect(t.fsCalls.length).toBe(0)
  })

  test(`a failed arm arms nothing (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], arm: { value: { exitCode: 3, stdout: '{"refused":"x"}', stderr: '' } } })
    expect((await t.spawn()).deny).toBe(DENY_ARM)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
  })

  test(`a read-only unknown call costs no file read, armed or not (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1'] })
    await t.spawn()
    expect((await t.check('ghost', 'Read', { file_path: '/x' }, { isReadOnly: true })).decision).toBe('allow')
    expect(t.fsCalls.length).toBe(0)
  })

  test(`an armed run keeps refusing while the marker stands, the run has not ended and the timeout holds (${surface})`, { timeoutMs: SLOW_MS }, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1'] })
    await t.spawn()
    await t.clock.advance(TTL)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
    expect(t.fsCalls).toEqual([`stat ${RUN}/.gate-01`, `stat ${RUN}/run-state.jsonl`, `read ${RUN}/run-state.jsonl`])
  })

  test(`an armed run disarms after the timeout, then reads nothing (${surface})`, { timeoutMs: SLOW_MS }, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1'] })
    await t.spawn()
    await t.clock.advance(TTL + 1)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
    t.fsCalls.length = 0
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
    expect(t.fsCalls.length).toBe(0)
  })

  test(`a new dispatch of the same run refreshes the timeout (${surface})`, { timeoutMs: SLOW_MS }, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1', 'rp2'] })
    await t.spawn()
    await t.clock.advance(TTL - 1000)
    await t.spawn({ prompt: `Output: .company/work/${SLUG}/02-reprompter.md\n` })
    await t.clock.advance(TTL - 1000)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
  })

  test(`one expired run does not disarm another armed run (${surface})`, { timeoutMs: SLOW_MS }, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1', 'rp2'] })
    await t.spawn()
    await t.clock.advance(TTL - 1000)
    await t.spawn({ prompt: `Output: .company/work/${OTHER_SLUG}/03-reprompter.md\n` })
    await t.clock.advance(2000)
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
  })

  for (const marker of ['gone', 'link', 'dir'] as const) {
    test(`an armed run disarms when the marker is ${marker} (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { rows: [], ids: ['rp1'], marker })
      await t.spawn()
      expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
    })
  }

  test(`an armed run disarms on an end line (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { rows: [], ids: ['rp1'], runState: '{"ev":"start"}\nnot json\n{"ev":"end","outcome":"ship"}\n' })
    await t.spawn()
    expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('allow')
  })

  for (const runState of ['gone', 'link', 'big', 'unreadable', '{"ev":"ended"}\n', 'garbage']) {
    test(`a run-state that is ${JSON.stringify(runState)} does not end the run (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { rows: [], ids: ['rp1'], runState })
      await t.spawn()
      expect((await t.check('ghost', 'Write', { file_path: '/x' })).decision).toBe('deny')
    })
  }

  test(`after disarm the recorded reprompter keeps its allow-list and an unrecorded one is still refused (${surface})`, { timeoutMs: SLOW_MS }, async ($, on) => {
    const rows = [{ id: 'old', type: 'aico:reprompter', description: 'd', status: 'running' }]
    const t = await boot($, on, surface, { rows, ids: ['rp1'] })
    await t.spawn()
    await t.clock.advance(TTL + 1)
    expect((await t.check('ghost', 'Bash', { command: 'ls' })).decision).toBe('allow')
    expect((await t.check('rp1', 'Write', { file_path: `${RUN}/prompt.md` })).decision).toBe('allow')
    expect((await t.check('rp1', 'Bash', { command: 'ls' })).decision).toBe('deny')
    expect((await t.check('old', 'Write', { file_path: `${RUN}/prompt.md` })).reason).toBe(DENY_NOT_STARTED)
  })

  test(`a reprompter evicted from the 50 records is denied through the list (${surface})`, async ($, on) => {
    const ids = Array.from({ length: 51 }, (_, i) => `rp${i}`)
    const rows = ids.map(id => ({ id, type: 'aico:reprompter', description: 'd', status: 'running' }))
    const t = await boot($, on, surface, { ids, rows })
    for (let i = 0; i < 51; i++) await t.spawn()
    expect((await t.check('rp0', 'Write', { file_path: `${RUN}/prompt.md` })).reason).toBe(DENY_NOT_STARTED)
    expect((await t.check('rp50', 'Write', { file_path: `${RUN}/prompt.md` })).decision).toBe('allow')
  })

  test(`other Roles and the main loop are untouched (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['ed1'] })
    const r = await t.spawn({ subagentType: 'aico:editor', prompt: 'Output: nonsense\n' })
    expect(r.agentId).toBe('ed1')
    expect(t.arms.length).toBe(0)
    expect(t.bottom.spawns).toBe(1)
    expect((await t.check('ed1', 'Bash', { command: 'ls' })).decision).toBe('allow')
    expect((await t.check('ed1', 'Write', { file_path: '/anywhere' })).decision).toBe('allow')
    expect((await t.check(undefined, 'Write', { file_path: '/anywhere' })).decision).toBe('allow')
    expect((await t.check(undefined, 'Bash', { command: 'ls' })).decision).toBe('allow')
    expect(t.bottom.lists).toBe(0)
    expect(t.toasts.length).toBe(0)
  })

  test(`look-alike agent types are not gated (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['a', 'b'] })
    await t.spawn({ subagentType: 'Reprompter' })
    await t.spawn({ subagentType: 'aico:reprompter2' })
    expect(t.arms.length).toBe(0)
  })

  test(`the gate works with every mod switched off (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { ids: ['rp1'], modsOff: true })
    expect((await t.spawn()).agentId).toBe('rp1')
    expect((await t.check('rp1', 'Bash', { command: 'ls' })).decision).toBe('deny')
    expect((await t.check('rp1', 'Write', { file_path: `${RUN}/prompt.md` })).decision).toBe('allow')
  })
}
