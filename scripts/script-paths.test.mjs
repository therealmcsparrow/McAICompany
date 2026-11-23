import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('hooks.json keeps its own direct script paths', () => {
  const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')
  assert.match(hooks, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//)
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
