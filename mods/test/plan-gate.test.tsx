import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const SHELLS = ['Bash', 'PowerShell'] as const
const ROOT = 'C:/plugins/aico/0.20.0'
const A = `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed`
const B = `node ${ROOT}/scripts/run.mjs run-state gate run-one plan passed`
const RECORD = '/work/.company/work/run-one/run-state.jsonl'
const DENY_ERROR = 'aico plan gate: plan-check error; fix the plan check, then retry'

type Env = Parameters<Parameters<typeof test>[1]>
type Answer = { exitCode: number; stdout: string } | 'reject' | 'hang' | 'noProcess' | 'poison'
const out = (policy: string, state: string, count: number) => JSON.stringify({ v: 1, policy, state, count, plan: null })
const exit = (exitCode: number, stdout: string): Answer => ({ exitCode, stdout })
const OPEN_BLOCK = exit(2, out('block', 'open', 1))
const PASS_BLOCK = exit(0, out('block', 'pass', 0))
const OPEN_WARN = exit(0, out('warn', 'open', 3))
const PASS_WARN = exit(0, out('warn', 'pass', 0))

async function boot($: Env[0], on: Env[1], surface: (typeof SURFACES)[number], answers: Answer[]) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const calls: string[][] = []
  const queue = [...answers]
  on('session.root', () => ({ value: '/work' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => (/^aico mods ready/.test(e.text) || toasts.push(e.text), { value: undefined }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('process.run', ((_: unknown, e: { argv: string[] }) => {
    if (!e.argv[1].endsWith('plan-check.mjs')) return { value: { exitCode: 0, stdout: '{}', stderr: '' } }
    calls.push(e.argv.slice(2))
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (next === 'reject') throw new Error('spawn failed')
    if (next === 'noProcess') return { deny: 'no process here' }
    if (next === 'poison') {
      return {
        value: {
          exitCode: 0,
          get stdout(): string {
            throw new Error('boom')
          },
          stderr: '',
        },
      }
    }
    if (next === 'hang') return new Promise(() => undefined)
    return { value: { exitCode: next.exitCode, stdout: next.stdout, stderr: '' } }
  }) as never)
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await clock.advance(0)
  const check = (tool: string, input: unknown) => $.tool.check({ tool, input } as never)
  const shell = (tool: string, command: string) => check(tool, { command })
  return { clock, toasts, calls, check, shell }
}

const reasonOf = (v: unknown) => (v as { reason?: string }).reason

for (const surface of SURFACES) {
  for (const tool of SHELLS) {
    for (const command of [A, B]) {
      test(`block with one open decision denies with the count (${tool}, ${surface})`, async ($, on) => {
        const t = await boot($, on, surface, [OPEN_BLOCK])
        const v = await t.shell(tool, command)
        expect(v.decision).toBe('deny')
        expect(reasonOf(v)).toBe('aico plan gate: 1 open decision; answer or settle them in the plan')
        expect(t.calls).toEqual([['verify', 'run-one', '--json']])
      })

      test(`no findings passes to next (${tool}, ${surface})`, async ($, on) => {
        const t = await boot($, on, surface, [PASS_BLOCK])
        expect((await t.shell(tool, command)).decision).toBe('allow')
        expect(t.toasts).toEqual([])
      })

      test(`warn with findings passes and the toast holds the count (${tool}, ${surface})`, async ($, on) => {
        const t = await boot($, on, surface, [OPEN_WARN])
        expect((await t.shell(tool, command)).decision).toBe('allow')
        expect(t.toasts).toEqual(['aico plan gate: 3 open decisions (warn)'])
      })

      test(`verify error passes under warn with a toast (${tool}, ${surface})`, async ($, on) => {
        const t = await boot($, on, surface, [exit(1, out('warn', 'error', 0))])
        expect((await t.shell(tool, command)).decision).toBe('allow')
        expect(t.toasts).toEqual(['plan-check error'])
      })

      test(`verify error denies under block (${tool}, ${surface})`, async ($, on) => {
        const t = await boot($, on, surface, [exit(1, out('block', 'error', 0))])
        const v = await t.shell(tool, command)
        expect(v.decision).toBe('deny')
        expect(reasonOf(v)).toBe(DENY_ERROR)
      })
    }
  }
}

for (const [name, answer] of [
  ['rejects', 'reject'],
  ['never answers', 'hang'],
  ['prints no JSON', exit(0, 'not json')],
  ['exits 7', exit(7, '')],
  ['exits 1 with no output', exit(1, '')],
] as [string, Answer][]) {
  test(`a verify that ${name} is refused once the policy is block`, async ($, on) => {
    const t = await boot($, on, 'terminal', [PASS_BLOCK, answer])
    expect((await t.shell('Bash', A)).decision).toBe('allow')
    const pending = t.shell('Bash', A)
    await t.clock.advance(6000)
    expect((await pending).decision).toBe('deny')
  })

  test(`a verify that ${name} passes with a toast once the policy is warn`, async ($, on) => {
    const t = await boot($, on, 'terminal', [PASS_WARN, answer])
    expect((await t.shell('Bash', A)).decision).toBe('allow')
    const pending = t.shell('Bash', A)
    await t.clock.advance(6000)
    expect((await pending).decision).toBe('allow')
    expect(t.toasts).toEqual(['plan-check error'])
  })
}

test('a surface without a process cannot judge and passes with a toast', async ($, on) => {
  const t = await boot($, on, 'desktop', ['noProcess'])
  expect((await t.shell('Bash', A)).decision).toBe('allow')
  expect(t.toasts).toEqual(['plan-check error'])
})

const NOT_JUDGED = [
  `${A};`,
  `${A} && echo`,
  `${A} | cat`,
  `FOO=1 ${A}`,
  `"node" ${ROOT}/scripts/run-state.mjs gate run-one plan passed`,
  `node "${ROOT}/scripts/run-state.mjs" gate run-one plan passed`,
  `node ${ROOT}/scripts/run-state.mjs gate 'run-one' plan passed`,
  `node ${ROOT}/scripts/other.mjs gate run-one plan passed`,
  `node ${ROOT}/scripts/run-state.mjs gate run-one plan changed`,
  `node ${ROOT}/scripts/run-state.mjs gate run-one brief passed`,
  `node ${ROOT}/scripts/run-state.mjs gate Run-One plan passed`,
  `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed extra`,
  `node ${ROOT}/scripts/run-state.mjs  gate run-one plan passed`,
  `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed\n`,
  `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed # x`,
  `node ${ROOT}/scripts/run-state.mjs gate $SLUG plan passed`,
  `node ${ROOT}/scripts/run-state.mjs gate ../x plan passed`,
  `node ${ROOT}/xscripts/run-state.mjs gate run-one plan passed`,
  `node ${ROOT}/scripts/run.mjs gate run-one plan passed`,
  `node --require x ${ROOT}/scripts/run-state.mjs gate run-one plan passed`,
]

test('a command that only looks similar is not judged', async ($, on) => {
  const t = await boot($, on, 'terminal', [OPEN_BLOCK])
  for (const tool of SHELLS) {
    for (const command of NOT_JUDGED) expect((await t.shell(tool, command)).decision).toBe('allow')
  }
  expect(t.calls).toEqual([])
})

test('other tools and odd inputs are not judged', async ($, on) => {
  const t = await boot($, on, 'terminal', [OPEN_BLOCK])
  expect((await t.check('Read', { file_path: RECORD })).decision).toBe('allow')
  expect((await t.check('Glob', { pattern: '**' })).decision).toBe('allow')
  expect((await t.check('Bash', {})).decision).toBe('allow')
  expect((await t.check('Bash', null)).decision).toBe('allow')
  expect((await t.check('Write', null)).decision).toBe('allow')
  expect(t.calls).toEqual([])
})

const RECORDS = [
  RECORD,
  'C:\\work\\.company\\work\\run-one\\run-state.jsonl',
  '.company/work/run-one/run-state.jsonl',
  '/work/.company/work/run-one/RUN-STATE.JSONL',
  '/work/.company/work/run-one/run-state.jsonl.',
  '/work/.company/work/run-one/run-state.jsonl::$DATA',
]

test('a Write or Edit on a run-state record is denied under block', async ($, on) => {
  const t = await boot($, on, 'terminal', [PASS_BLOCK])
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    for (const path of RECORDS) expect((await t.check(tool, { file_path: path })).decision).toBe('deny')
  }
})

test('a Write or Edit on a run-state record passes under warn', async ($, on) => {
  const t = await boot($, on, 'terminal', [PASS_WARN])
  expect((await t.check('Write', { file_path: RECORD })).decision).toBe('allow')
  expect((await t.check('Edit', { file_path: RECORD })).decision).toBe('allow')
})

test('a Write on another file passes under block', async ($, on) => {
  const t = await boot($, on, 'terminal', [PASS_BLOCK])
  for (const path of ['/work/.company/work/run-one/02-plan.md', '/work/.company/work/run-one/run-state.jsonl.bak', '/work/src/run-state.jsonl', '/work/.company/work/run-state.jsonl']) {
    expect((await t.check('Write', { file_path: path })).decision).toBe('allow')
  }
})

test('the mod failing under block refuses', async ($, on) => {
  const t = await boot($, on, 'terminal', [PASS_BLOCK, 'poison'])
  expect((await t.shell('Bash', A)).decision).toBe('allow')
  const v = await t.shell('Bash', A)
  expect(v.decision).toBe('deny')
})

test('the mod failing under warn goes on to next', async ($, on) => {
  const t = await boot($, on, 'terminal', [PASS_WARN, 'poison'])
  expect((await t.shell('Bash', A)).decision).toBe('allow')
  expect((await t.shell('Bash', A)).decision).toBe('allow')
})

test('the deny names counts, never plan text', async ($, on) => {
  const t = await boot($, on, 'terminal', [exit(2, JSON.stringify({ v: 1, policy: 'block', state: 'open', count: 2, plan: 'SECRET plan text' }))])
  const v = await t.shell('Bash', A)
  expect(reasonOf(v)).toBe('aico plan gate: 2 open decisions; answer or settle them in the plan')
})
