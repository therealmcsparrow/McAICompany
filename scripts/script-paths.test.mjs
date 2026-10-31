import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function mdFiles(dir) {
  const out = []
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) out.push(...mdFiles(p))
    else if (d.name.endsWith('.md')) out.push(p)
  }
  return out
}
const files = [...mdFiles(path.join(ROOT, 'skills')), ...mdFiles(path.join(ROOT, 'agents'))]
const lines = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((text, i) => ({ f: path.relative(ROOT, f), n: i + 1, text })))

test('no skill or agent names a script path other than run.mjs', () => {
  const bad = lines.filter((l) => [...l.text.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)].some((m) => m[1] !== 'run.mjs'))
  assert.deepEqual(bad.map((l) => `${l.f}:${l.n}`), [])
})

test('every run.mjs call uses the substituted root and a valid script name', () => {
  const calls = lines.filter((l) => l.text.includes('scripts/run.mjs'))
  assert.ok(calls.length > 50)
  for (const l of calls) {
    for (const m of l.text.matchAll(/scripts\/run\.mjs/g)) {
      const before = l.text.slice(Math.max(0, m.index - 30), m.index)
      assert.ok(before.endsWith('node "${CLAUDE_PLUGIN_ROOT}/') || before.endsWith('node ${CLAUDE_PLUGIN_ROOT}/'), `${l.f}:${l.n}`)
    }
    for (const m of l.text.matchAll(/scripts\/run\.mjs" ([A-Za-z0-9_-]+)/g)) {
      assert.match(m[1], /^[a-z][a-z0-9-]{0,40}$/, `${l.f}:${l.n}`)
      assert.ok(fs.existsSync(path.join(ROOT, 'scripts', `${m[1]}.mjs`)), `${l.f}:${l.n} names ${m[1]}`)
    }
  }
})

test('hooks.json keeps its own direct script paths', () => {
  const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')
  assert.match(hooks, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//)
})

test('the Plan Gate command is in the run.mjs form the plan-gate mod judges', async () => {
  const runState = fs.readFileSync(path.join(ROOT, 'skills', 'pipeline', 'references', 'run-state.md'), 'utf8')
  const m = runState.match(/node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.mjs run-state gate '<slug>' plan passed/)
  assert.ok(m, 'run-state reference names the plan gate command')
  const { parseGateCommand } = await import('../mods/lib/plan-gate.mjs')
  const command = m[0].replace('${CLAUDE_PLUGIN_ROOT}', '/p/cache/aico/aico/0.20.0').replace('<slug>', 'run-one')
  assert.equal(parseGateCommand(command), 'run-one')
})

test('run.mjs run-state gate under block with an open decision is refused and the code passes through', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'script-paths-'))
  try {
    const runDir = path.join(tmp, '.company', 'work', 'one')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, '02-plan.md'), '# Plan\n\n## Decisions\n- Open: which database?\n')
    const cfg = path.join(tmp, 'mcsparrow')
    fs.mkdirSync(cfg)
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ version: 1, plan_check: { policy: 'block' } }))
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: tmp, USERPROFILE: tmp, MCSPARROW_HOME: cfg }
    const direct = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-state.mjs'), 'gate', 'one', 'plan', 'passed'], { cwd: tmp, env, encoding: 'utf8' })
    const viaRun = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), 'run-state', 'gate', 'one', 'plan', 'passed'], { cwd: tmp, env, encoding: 'utf8' })
    assert.equal(viaRun.status, direct.status)
    assert.notEqual(viaRun.status, 0)
    assert.equal(viaRun.stderr, direct.stderr)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('dispatch profile paths resolve through plugin-root', () => {
  const pipeline = fs.readFileSync(path.join(ROOT, 'skills', 'pipeline', 'SKILL.md'), 'utf8')
  assert.match(pipeline, /scripts\/run\.mjs" plugin-root/)
  assert.doesNotMatch(pipeline, /two folders above this skill/)
})
