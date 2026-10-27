import { expect, mock, test } from 'claude-code/testing'

const MODS = {
  savvy: { enabled: true, pane: 'command' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' },
}
const settingsJson = (blast: object) => JSON.stringify({ revision: 1, roles: {}, mods: { ...MODS, blast_radius: blast } })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
const depth = (paths: [string, string[]][], extra: object = {}) =>
  JSON.stringify({
    v: 1, source: 'staged', base: null, tier: 'unknown', depth: 'full', truncated: false,
    paths: paths.map(([path, categories]) => ({ path, categories, module: null })), ...extra,
  })
const CORE = depth([['skills/x.md', ['core']]])
const SEC = depth([['mods/x.ts', ['security']]])
const CONTRACT = depth([['docs/contracts/x.md', ['contract']]])
const PLAIN = depth([['a.txt', []]], { depth: 'standard' })
const ACTIVE = JSON.stringify({ slug: null, view: null })

type Run = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Env = Parameters<Parameters<typeof test>[1]>
type Opts = { blast?: object; review?: unknown; core?: string; approver?: string; noProcess?: boolean }
const SURFACES = ['terminal', 'desktop'] as const
const GIT = { Bash: 'git commit -m "x"', PowerShell: 'cd sub; git add .; git commit -m x' } as const
const TOOLS = ['Bash', 'PowerShell'] as const

async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], o: Opts = {}) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const logs: string[] = []
  const calls: string[][] = []
  on('session.root', () => ({ value: '/work' }))
  const kept = new Map<string, unknown>()
  on('state.get', ((_: unknown, e: { plugin: string; key: string }) => {
    return { value: { value: kept.get(`${e.plugin}/${e.key}`), version: 0 } }
  }) as never)
  on('state.set', ((_: unknown, e: { plugin: string; key: string; value: unknown }) => {
    kept.set(`${e.plugin}/${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => (/^aico mods ready/.test(e.text) || toasts.push(e.text), { value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }))
  on('tool.check', () => ({ decision: (o.core ?? 'allow') as 'allow' }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'r1' }))
  // An agent the session lists but the gate did not see spawn: the write gate asks the list once.
  on('agent.list', () => ({ value: [{ id: 'a1b2', type: 'general-purpose', description: 'd', status: 'running' }] }) as never)
  on('process.run', ((_: unknown, e: Run) => {
    calls.push(e.argv.slice(1))
    if (o.noProcess) return { deny: 'no process here' }
    if (e.argv[1].endsWith('settings.mjs')) return ok(settingsJson(o.blast ?? MODS.blast_radius))
    if (e.argv[1].endsWith('run-state.mjs')) return ok(ACTIVE)
    return (o.review ?? ok(PLAIN)) as never
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(0)
  const check = (tool: string, command: string, extra: object = {}) =>
    $.tool.check({ tool, input: { command }, approver: o.approver, ...extra } as never)
  const breakSettings = () => kept.set('aico/settings', { shape: 'v1', value: { known: true, mods: null, roles: {} } })
  return { clock, toasts, statuses, logs, calls, check, breakSettings }
}

for (const surface of SURFACES) {
  for (const tool of TOOLS) {
    test(`a ${tool} commit with a Core hit asks when a person can answer (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { review: ok(CORE), approver: 'person' })
      const r = await t.check(tool, GIT[tool])
      expect(r.decision).toBe('ask')
      expect(r.reason).toMatch(/^Blast Radius: Core: skills\/x\.md/)
      expect(r.reason!.length <= 600).toBe(true)
      expect(t.logs.some(l => l.includes('skills/x.md'))).toBe(true)
    })

    test(`a ${tool} commit with a security hit and no approver is refused (${surface})`, async ($, on) => {
      const t = await boot($, on, surface, { review: ok(SEC) })
      const r = await t.check(tool, GIT[tool])
      expect(r.decision).toBe('deny')
      expect(r.reason).toContain('nobody can be asked; commit refused')
      expect(r.reason!.length <= 600).toBe(true)
    })
  }

  test(`a Contract-only commit warns with a toast and a status part, and goes on (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { review: ok(CONTRACT) })
    const r = await t.check('Bash', GIT.Bash)
    expect(r.decision).toBe('allow')
    expect(t.toasts.length).toBe(1)
    expect(t.statuses[t.statuses.length - 1]).toBe('aico idle · ⚠ contract')
    await t.clock.advance(60000)
    expect(t.statuses[t.statuses.length - 1]).toBe('aico idle')
  })

  test(`a script failure is a security hit and asks with a person (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { review: { deny: 'boom' }, approver: 'person' })
    expect((await t.check('PowerShell', GIT.PowerShell)).decision).toBe('ask')
  })

  test(`a missing $.process is a security hit and refuses without an approver (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { noProcess: true })
    const r = await t.check('Bash', GIT.Bash)
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('Security: unknown')
  })
}

const BAD: [string, unknown][] = [
  ['bad JSON', ok('{bad')],
  ['exit code 2', { value: { exitCode: 2, stdout: SEC, stderr: '' } }],
  ['over-size output', ok('x'.repeat(300000))],
  ['truncated output', { value: { exitCode: 0, stdout: SEC, stderr: '', isStdoutTruncated: true } }],
  ['a value outside the allow-list', ok(JSON.stringify({ v: 1, tier: 'root' }))],
]
for (const [name, bad] of BAD) {
  test(`${name} counts as a security hit`, async ($, on) => {
    const t = await boot($, on, 'terminal', { review: bad, approver: 'host' })
    expect((await t.check('Bash', GIT.Bash)).decision).toBe('ask')
  })
}

test('a deny from beneath is returned as it is, without a script call', async ($, on) => {
  const t = await boot($, on, 'terminal', { core: 'deny', review: ok(CORE) })
  const before = t.calls.length
  expect((await t.check('Bash', GIT.Bash)).decision).toBe('deny')
  expect(t.calls.length).toBe(before)
})

test('a non-commit and a non-shell tool are not gated', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(CORE), approver: 'person' })
  const before = t.calls.length
  expect((await t.check('Bash', 'git log --grep commit')).decision).toBe('allow')
  expect((await t.check('PowerShell', 'Write-Output commit')).decision).toBe('allow')
  expect((await t.check('Read', 'git commit')).decision).toBe('allow')
  expect(t.calls.length).toBe(before)
})

test('doubt counts as a commit: an unterminated quote naming git commit is gated', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(CORE), approver: 'person' })
  expect((await t.check('Bash', 'echo "x; git commit -m y')).decision).toBe('ask')
})

test('a project that sets security to warn is not asked', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(SEC), blast: { enabled: true, core: 'ask', contract: 'warn', security: 'warn' } })
  expect((await t.check('Bash', GIT.Bash)).decision).toBe('allow')
})

test('off calls no script for a commit and shows nothing', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(CORE), blast: { enabled: false, core: 'ask', contract: 'warn', security: 'ask' } })
  const before = t.calls.length
  expect((await t.check('Bash', GIT.Bash)).decision).toBe('allow')
  expect(t.calls.length).toBe(before)
  expect(t.toasts.length).toBe(0)
})

test('a subagent commit starts with From subagent', async ($, on) => {
  await boot($, on, 'terminal', { review: ok(SEC) })
  const r = await $.tool.check({ tool: 'Bash', input: { command: GIT.Bash }, agentId: 'a1b2' } as never)
  expect(r.reason).toMatch(/^From subagent a1b2: Blast Radius: /)
})

test('the script arguments are an array: worktree for -a, repo from -C', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(PLAIN) })
  await t.check('Bash', 'git -C sub/dir commit -am x')
  const last = t.calls[t.calls.length - 1]
  expect(last.slice(1)).toEqual(['--worktree', '--json', '--repo', 'sub/dir'])
})

test('a code-reviewer dispatch lists the touched paths and never blocks', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(CORE) })
  const prompt = 'Output: .company/work/x/12-code-reviewer.md\nBase commit: 1551e10\nRisk tier: high\n'
  const r = await $.agent.spawn({ prompt, subagentType: 'aico:code-reviewer' })
  expect(r.deny).toBe(undefined)
  const last = t.calls[t.calls.length - 1]
  expect(last.slice(1)).toEqual(['1551e10', '--json', '--risk', 'high'])
  expect(t.toasts.length).toBe(1)
  expect(t.logs.some(l => l.includes('skills/x.md'))).toBe(true)
})

test('a failing review-depth on a dispatch still lets the dispatch through', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: { deny: 'boom' } })
  const r = await $.agent.spawn({ prompt: 'Base commit: 1551e10', subagentType: 'code-reviewer' })
  expect(r.deny).toBe(undefined)
  expect(t.toasts.length).toBe(0)
})

test('an error in the hook denies a commit and passes any other shell call', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(PLAIN), approver: 'person' })
  t.breakSettings()
  for (const tool of TOOLS) {
    const r = await t.check(tool, 'git commit -m x')
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('Blast Radius failed; commit refused')
    expect((await t.check(tool, 'ls -la')).decision).toBe('allow')
  }
})

test('a dispatched subagent commit starts with From subagent <Step> <role>', async ($, on) => {
  await boot($, on, 'terminal', { review: ok(SEC) })
  const prompt = 'Output: .company/work/x/12-backend-engineer.md\nBase commit: 1551e10\nRisk tier: high\n'
  const spawned = await $.agent.spawn({ prompt, subagentType: 'aico:backend-engineer' })
  expect(spawned.deny).toBe(undefined)
  const r = await $.tool.check({ tool: 'Bash', input: { command: GIT.Bash }, agentId: 'r1' } as never)
  expect(r.decision).toBe('deny')
  expect(r.reason).toMatch(/^From subagent 12 backend-engineer: Blast Radius: /)
  expect(r.reason).toContain('nobody can be asked; commit refused')
})

test('a subagent whose dispatch line is odd falls back to its cleaned id', async ($, on) => {
  await boot($, on, 'terminal', { review: ok(SEC) })
  await $.agent.spawn({ prompt: 'Output: ../../x/12-backend-engineer.md', subagentType: 'aico:backend-engineer' })
  const r = await $.tool.check({ tool: 'Bash', input: { command: GIT.Bash }, agentId: 'r1' } as never)
  expect(r.reason).toMatch(/^From subagent r1: Blast Radius: /)
})

const READS_ALL = ['--worktree', '--json']
for (const [shell, command] of [
  ['Bash', 'git add -A && git commit -m x'],
  ['Bash', 'git add mods/a.ts; git commit -m x'],
  ['Bash', 'git commit --pathspec-from-file=p.txt'],
  ['Bash', 'git commit -m x'],
  ['PowerShell', 'git add .; git commit -m x'],
] as const) {
  test(`${shell}: "${command}" reads worktree, staged and untracked, never staged only`, async ($, on) => {
    const t = await boot($, on, 'terminal', { review: ok(CORE), approver: 'person' })
    const r = await t.check(shell, command)
    expect(r.decision).toBe('ask')
    const last = t.calls[t.calls.length - 1]
    expect(last.slice(1)).toEqual(READS_ALL)
    expect(t.calls.some(c => c.includes('--staged'))).toBe(false)
  })
}

const EVASIONS: [string, string][] = [
  ['Bash', 'G=git; $G commit -m x'],
  ['Bash', "$'git' commit -m x"],
  ['Bash', 'git -c alias.ci=commit ci -m x'],
  ['Bash', 'find . -exec git commit -m x \\;'],
  ['Bash', 'stdbuf -o0 git commit'],
  ['Bash', 'echo commit | xargs git'],
  ['Bash', '/usr/bin/gi? commit'],
  ['Bash', 'git commit-tree abc'],
  ['Bash', 'node -e "require(\'child_process\').execSync(\'git commit -m x\')"'],
  ['PowerShell', "$g='git'; & $g commit"],
  ['PowerShell', '. git commit -m x'],
  ['PowerShell', 'git @a'],
  ['PowerShell', '& (Get-Command git) commit'],
  ['PowerShell', 'git.cmd commit -m x'],
]
for (const [shell, command] of EVASIONS) {
  test(`${shell}: the evasion "${command}" is gated like a commit`, async ($, on) => {
    const t = await boot($, on, 'terminal', { review: ok(CORE), approver: 'person' })
    expect((await t.check(shell, command)).decision).toBe('ask')
  })
}

for (const command of [
  'git --git-dir=/x/.git commit -m y',
  'git --work-tree=/x commit -m y',
  'GIT_DIR=/x/.git git commit -m y',
  'GIT_WORK_TREE=/x git commit -m y',
  'GIT_INDEX_FILE=/tmp/idx git commit -m y',
]) {
  test(`"${command}" is an unknown security hit, without a script call`, async ($, on) => {
    const t = await boot($, on, 'terminal', { review: ok(PLAIN), approver: 'person' })
    const before = t.calls.length
    const r = await t.check('Bash', command)
    expect(r.decision).toBe('ask')
    expect(r.reason).toContain('Security: unknown')
    expect(t.calls.length).toBe(before)
  })
}

test('an evasion with nobody to ask is refused', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(CORE) })
  const r = await t.check('Bash', 'g=git; $g commit -m x')
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('nobody can be asked; commit refused')
})

test('an override with nobody to ask is refused, without a script call', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(PLAIN) })
  const before = t.calls.length
  const r = await t.check('Bash', 'GIT_DIR=/x/.git git commit -m y')
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('nobody can be asked; commit refused')
  expect(t.calls.length).toBe(before)
})

test('the hook error path denies the evasions too', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(PLAIN), approver: 'person' })
  t.breakSettings()
  for (const [shell, command] of EVASIONS) {
    const r = await t.check(shell, command)
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('Blast Radius failed; commit refused')
  }
})

test('the gate never answers allow for a hit, whatever the commit form', async ($, on) => {
  const t = await boot($, on, 'terminal', { review: ok(SEC), approver: 'person' })
  for (const [shell, command] of [...EVASIONS, ['Bash', 'git add -A && git commit -m x']]) {
    expect((await t.check(shell, command)).decision).not.toBe('allow')
  }
})
