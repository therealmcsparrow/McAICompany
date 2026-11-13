import { expect, mock, test } from 'claude-code/testing'

import { cellWidth } from '../lib/format.mjs'
import { MODS_DEFAULTS, guardSettings } from '../lib/guard.mjs'
import { readyText } from '../lib/ready.mjs'
import { STATUS_CAPS, composeStatus } from '../lib/status.mjs'
import { resetStatus, setStatusPart } from '../shared/status'

const MODS = {
  savvy: { enabled: true, pane: 'command' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
}
const SETTINGS = JSON.stringify({ revision: 1, roles: {}, mods: MODS })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
const DIRTY = JSON.stringify({
  v: 1, source: 'worktree', base: null, tier: 'unknown', depth: 'full', truncated: false,
  paths: [
    { path: 'skills/handoff/SKILL.md', categories: ['core'], module: null },
    { path: 'docs/contracts/aico-mods.md', categories: ['contract'], module: null },
    { path: 'mods/shared/run-script.ts', categories: ['security'], module: null },
  ],
})
const ACTIVE = JSON.stringify({ slug: null, view: null })

type Run = { argv: string[]; init: { cwd: string; timeoutMs: number } }
type Env = Parameters<Parameters<typeof test>[1]>
const SURFACES = ['terminal', 'desktop'] as const

const COMMITS: [string, string][] = [
  ['Bash', 'git commit -am x'],
  ['PowerShell', 'git commit -am x'],
  // Hostile forms first: the old gate treated every one of these as a commit it had to answer for.
  ['Bash', 'G=git; $G commit -m x'],
  ['Bash', 'GIT_DIR=/x/.git git commit -m y'],
  ['Bash', 'echo "x; git commit -m y'],
  ['Bash', 'git add -A && git commit -m x'],
  ['PowerShell', "$g='git'; & $g commit"],
  ['PowerShell', 'git add .; git commit -m x'],
]

async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], opts: { noProcess?: boolean } = {}) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const logs: string[] = []
  const calls: string[][] = []
  const stateKeys: string[] = []
  on('session.root', () => ({ value: '/work' }))
  const kept = new Map<string, unknown>()
  on('state.get', ((_: unknown, e: { plugin: string; key: string }) => {
    return { value: { value: kept.get(`${e.plugin}/${e.key}`), version: 0 } }
  }) as never)
  on('state.set', ((_: unknown, e: { plugin: string; key: string; value: unknown }) => {
    stateKeys.push(e.key)
    kept.set(`${e.plugin}/${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } }
  }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'r1' }))
  on('agent.list', () => ({ value: [{ id: 'a1b2', type: 'general-purpose', description: 'd', status: 'running' }] }) as never)
  on('process.run', ((_: unknown, e: Run) => {
    calls.push(e.argv.slice(1))
    if (opts.noProcess) return { deny: 'no process here' }
    if (e.argv[1].endsWith('settings.mjs')) return ok(SETTINGS)
    if (e.argv[1].endsWith('run-state.mjs')) return ok(ACTIVE)
    return ok(DIRTY)
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(0)
  const check = (tool: string, command: string, extra: object = {}) =>
    $.tool.check({ tool, input: { command }, ...extra } as never)
  const reviewCalls = () => calls.filter(c => c.some(a => a.includes('review-depth')))
  return { clock, toasts, statuses, logs, calls, stateKeys, check, reviewCalls }
}

for (const surface of SURFACES) {
  for (const [tool, command] of COMMITS) {
    for (const approver of [undefined, 'person'] as const) {
      test(`${tool} "${command}" passes through with Core, Contract and security paths dirty (${surface}, approver ${approver ?? 'none'})`, async ($, on) => {
        const t = await boot($, on, surface)
        const before = t.statuses.length
        const r = await t.check(tool, command, { approver })
        expect(r.decision).toBe('allow')
        expect(r.reason).toBeUndefined()
        expect(t.reviewCalls().length).toBe(0)
        expect(t.toasts.filter(x => !/^aico.* mods ready/.test(x))).toEqual([])
        expect(t.logs.some(l => /skills\/handoff|aico-mods|run-script/.test(l))).toBe(false)
        await t.clock.advance(60_000)
        expect(t.statuses.slice(before).some(s => s !== undefined && s.includes('⚠'))).toBe(false)
        expect(t.stateKeys.includes('blast')).toBe(false)
      })
    }
  }

  test(`a subagent commit gets no From subagent answer (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    const r = await t.check('Bash', 'git commit -am x', { agentId: 'a1b2' })
    expect(r.decision).toBe('allow')
    expect(r.reason).toBeUndefined()
    expect(t.reviewCalls().length).toBe(0)
  })

  test(`a missing process capability does not turn a commit into a refusal (${surface})`, async ($, on) => {
    const t = await boot($, on, surface, { noProcess: true })
    for (const [tool, command] of COMMITS) {
      const r = await t.check(tool, command)
      expect(r.decision).toBe('allow')
    }
  })

  test(`a code-reviewer dispatch calls no review-depth script and shows no path list (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    const prompt = 'Output: .company/work/x/12-code-reviewer.md\nBase commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nRisk tier: high\n'
    const r = await $.agent.spawn({ prompt, subagentType: 'aico:code-reviewer' })
    expect(r.deny).toBe(undefined)
    expect(t.reviewCalls().length).toBe(0)
    expect(t.toasts.filter(x => !/^aico.* mods ready/.test(x))).toEqual([])
    expect(t.logs.some(l => l.includes('skills/handoff'))).toBe(false)
  })

  test(`the ready toast lists three mods and the idle status carries no extra part (${surface})`, async ($, on) => {
    const t = await boot($, on, surface)
    expect(t.toasts.filter(x => /mods ready/.test(x))).toEqual(['aico mods ready: Savvy, Cache Tax, Reflect'])
    expect(t.statuses[0]).toBe('aico idle')
  })
}

test('readyText gives the version, then the three mods in order', () => {
  const on = { enabled: true }
  expect(readyText({ savvy: on, cache_tax: on, reflect: on }, true, '0.37.0')).toBe('aico 0.37.0 mods ready: Savvy, Cache Tax, Reflect')
  expect(readyText({ ...MODS, blast_radius: on }, true, '0.37.0')).toBe('aico 0.37.0 mods ready: Savvy, Cache Tax, Reflect')
})

test('readyText ignores a retired mod key whatever its value', () => {
  const hostile = JSON.parse('{"savvy":{"enabled":true},"blast_radius":{"enabled":true},"Blast Radius":{"enabled":true}}')
  expect(readyText(hostile, true, '0.37.0')).toBe('aico 0.37.0 mods ready: Savvy')
  expect(readyText({ blast_radius: { enabled: true } }, true)).toBe('aico mods ready: none on')
})

test('a status built from every part has no blast part and fits 80 columns with the host prefix', () => {
  const all = {
    version: 'v0.37.0', savvy: 'W3 S12 be-eng 14m', cost: '12.4k tax 60m', reflect: '20 lessons', blast: '⚠ security',
  }
  const line = composeStatus(all, { idle: true }) ?? ''
  expect(line).toBe('v0.37.0 · W3 S12 be-eng 14m · 12.4k tax 60m · 20 lessons')
  expect(line.includes('⚠')).toBe(false)
  expect(8 + cellWidth(line)).toBeLessThanOrEqual(80)
  const worst = composeStatus({
    version: 'v' + '9'.repeat(40), savvy: '漢'.repeat(80), cost: '漢'.repeat(80), reflect: '漢'.repeat(80), blast: '漢'.repeat(80),
  }, { idle: true }) ?? ''
  expect(worst.split(' · ').length).toBe(4)
  expect(8 + cellWidth(worst)).toBeLessThanOrEqual(80)
})

test('the status caps name the four remaining parts', () => {
  expect(Object.keys(STATUS_CAPS).sort()).toEqual(['cost', 'reflect', 'savvy', 'version'])
})

test('setStatusPart ignores the retired blast key and writes nothing for it', async () => {
  resetStatus()
  const written: (string | undefined)[] = []
  const fake = { ui: { status: async (text: string | undefined) => void written.push(text) } }
  await setStatusPart(fake as never, 'blast' as never, '⚠ core')
  expect(written).toEqual([])
  await setStatusPart(fake as never, 'cost' as never, '5 tax')
  expect(written).toEqual(['aico idle · 5 tax'])
  await setStatusPart(fake as never, 'blast' as never, '⚠ contract')
  expect(written).toEqual(['aico idle · 5 tax'])
  resetStatus()
})

test('the guard defaults hold three mods and a settings answer with an extra retired key is still read without it', () => {
  expect(Object.keys(MODS_DEFAULTS).sort()).toEqual(['cache_tax', 'reflect', 'savvy'])
  const extra = guardSettings({ roles: {}, mods: { ...MODS, blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' } } })
  expect(extra).toBeDefined()
  expect(Object.keys(extra!.mods).sort()).toEqual(['cache_tax', 'reflect', 'savvy'])
  expect(guardSettings({ roles: {}, mods: MODS })).toBeDefined()
})
