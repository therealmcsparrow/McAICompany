// Characterization of the quick commands: stdout, stderr and exit code on a fixed input.
// Quick commands print no progress line, so stderr stays exactly what it is today.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const QUICK_LIMIT_MS = 5000

let root
let home
before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'progress-quick-')))
  home = path.join(root, 'home')
  fs.mkdirSync(home)
  fs.mkdirSync(path.join(root, 'docs', 'specs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs', 'specs', 'a.md'), '# Spec\n')
  fs.writeFileSync(path.join(root, 'bad-handoff.md'), 'x\n')
})
after(() => fs.rmSync(root, { recursive: true, force: true }))

function run(script, args) {
  const env = { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home }
  delete env.NODE_TEST_CONTEXT
  delete env.AICO_PROGRESS_HEARTBEAT_MS
  const started = Date.now()
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd: root, env, encoding: 'utf8', shell: false, timeout: 60000,
  })
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - started }
}

const USAGE_RUN_STATE = 'refused: usage: start <slug> [<aico version>] | ceo <slug> <brief|plan|ship|none> <1-20> | sub <slug> <start|stop> <role> <id> [<session>] | wave <slug> <n> | ask <slug> <brief|plan|ship> | gate <slug> <brief|plan|ship> <passed|changed|stopped> | pick <slug> <use|edit|keep|stop> <asked> | end <slug> <ship|abort> | show <slug> --json | active --json | list --json | projects --json | triage issue | triage check <nonce> [--route fix]\n'
const USAGE_REVIEW_LOOP = 'refused: usage: attempt <slug> <step> <role> <round> <reason> | mark <slug> <round> --base <full id> | churn <slug> <round> --base <full id> | gate <slug> [--base <full id>]\n'
const USAGE_PLAN_CHECK = [
  'refused: usage: plan-check.mjs <command>',
  '  gate <slug> <plan-name> --policy <warn|block> [--json]',
  '  off <slug>',
  '  wave <slug> <n>',
  '  verify <slug> [<plan-name>] [--json]',
  '  read <slug>',
].join('\n') + '\n'

// [label, script, args, code, stdout check, stderr]
const CASES = [
  ['handoff-lint refuses no args', 'handoff-lint.mjs', [], 2, /^usage: node scripts\/handoff-lint\.mjs <handoff\.md>/, ''],
  ['handoff-lint unreadable file', 'handoff-lint.mjs', ['nope.md'], 1, 'ERROR cannot read file\n', ''],
  ['handoff-lint no frontmatter', 'handoff-lint.mjs', ['bad-handoff.md'], 1, 'ERROR missing frontmatter\n', ''],
  ['plan-check refuses no args', 'plan-check.mjs', [], 3, USAGE_PLAN_CHECK, ''],
  ['plan-check read, no state', 'plan-check.mjs', ['read', 'slug1'], 0, '{"v":1,"slug":"slug1","state":"none"}\n', ''],
  ['plan-check verify, no plan', 'plan-check.mjs', ['verify', 'slug1'], 1, 'plan-check (warn): error no plan\n', ''],
  ['plan-check-verdict refuses no args', 'plan-check-verdict.mjs', [], 3, 'refused: usage: plan-check-verdict.mjs verdict [--runs <3-50>] | history [--labels <file>] [--limit <n>] [--json]\n', ''],
  ['spec-check refuses no args', 'spec-check.mjs', [], 3, 'refused: usage: spec-check.mjs check <file> | stamp <file> --version <x.y.z> --date <YYYY-MM-DD>\n', ''],
  ['spec-check refuses missing spec', 'spec-check.mjs', ['check', 'docs/specs/none.md'], 3, 'refused: spec path is not a plain path under the root\n', ''],
  ['spec-check lists errors of a bad spec', 'spec-check.mjs', ['check', 'docs/specs/a.md'], 2, /^ERROR line 1: bad frontmatter\n/, ''],
  ['review-loop refuses no args', 'review-loop.mjs', [], 3, USAGE_REVIEW_LOOP, ''],
  ['review-loop gate, no data', 'review-loop.mjs', ['gate', 'slug1'], 0, 'review-loop: nothing to report\n', ''],
  ['run-state refuses bad command', 'run-state.mjs', ['bogus'], 2, USAGE_RUN_STATE, ''],
  ['run-state list, empty home', 'run-state.mjs', ['list', '--json'], 0, '{"v":1,"runs":[],"warnings":[]}\n', ''],
  ['run refuses bad name', 'run.mjs', ['Bad'], 2, '', 'aico run: bad script name\n'],
  ['run refuses itself', 'run.mjs', ['run'], 2, '', 'aico run: bad script name\n'],
  ['run refuses no args', 'run.mjs', [], 2, '', 'aico run: bad script name\n'],
  ['run refuses unknown script', 'run.mjs', ['nopescript'], 2, '', 'aico run: unknown script\n'],
  ['run passes a subcommand through', 'run.mjs', ['run-state', 'list', '--json'], 0, '{"v":1,"runs":[],"warnings":[]}\n', ''],
  ['check --drift on an empty root', 'check.mjs', ['--drift', '.'], 0, '0 error(s)\n', ''],
  ['check --drift refuses extra args', 'check.mjs', ['--drift', 'a', 'b'], 2, '', 'usage: check.mjs --drift [repo root]\n'],
  ['check --packs refuses a missing folder', 'check.mjs', ['--packs', 'nope'], 1, 'ERROR nope: not a folder\n1 error(s)\n', ''],
  ['check --packs refuses no folder', 'check.mjs', ['--packs'], 2, '', 'usage: check.mjs --packs <library folder>\n'],
]

function matches(actual, expected) {
  if (expected instanceof RegExp) assert.match(actual, expected)
  else assert.equal(actual, expected)
}

for (const [label, script, args, code, out, err] of CASES) {
  test(`quick command pinned: ${label}`, () => {
    const r = run(script, args)
    assert.equal(r.code, code, `exit code (stderr: ${r.err})`)
    matches(r.out, out)
    assert.equal(r.err, err)
    assert.doesNotMatch(r.err + r.out, /\[progress\]|heartbeat/i)
  })
}

test('quick commands finish under the quick limit, one timed run each', () => {
  const seen = new Map()
  for (const [, script, args] of CASES) {
    const key = `${script} ${args[0] ?? ''}`.trim()
    if (seen.has(key)) continue
    seen.set(key, run(script, args).ms)
  }
  for (const [key, ms] of seen) {
    assert.ok(ms < QUICK_LIMIT_MS, `${key} took ${ms} ms, a quick command stays under ${QUICK_LIMIT_MS} ms`)
  }
})
