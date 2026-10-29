import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === 'win32'
let tmp, home, cwdA, cwdB

const VER = (v) => path.join(home, '.claude', 'plugins', 'cache', 'mk', 'plug', v)
const RECORD = () => path.join(home, '.claude', 'plugins', 'installed_plugins.json')

function makeVersion(dir, name = 'plug') {
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
  for (const f of ['run.mjs', 'plugin-root.mjs']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dir, 'scripts', f))
  fs.writeFileSync(path.join(dir, 'scripts', 'probe.mjs'), 'console.log("probe:" + process.argv.slice(2).join(",")); process.exit(Number(process.env.PROBE_EXIT || 0))\n')
}
function record(obj) {
  fs.mkdirSync(path.dirname(RECORD()), { recursive: true })
  fs.writeFileSync(RECORD(), typeof obj === 'string' ? obj : JSON.stringify(obj))
}
const entries = (list) => ({ version: 2, plugins: { 'plug@mk': list } })
const baseEnv = () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home })
function run(version, script, args = [], { cwd = cwdA, env = {} } = {}) {
  return spawnSync(process.execPath, [path.join(VER(version), 'scripts', script), ...args], {
    cwd, encoding: 'utf8', env: { ...baseEnv(), ...env }
  })
}
function runAt(dir, script, args = []) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], { encoding: 'utf8', env: baseEnv() })
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-root-')))
  home = path.join(tmp, 'home')
  cwdA = path.join(tmp, 'projA')
  cwdB = path.join(tmp, 'projB')
  fs.mkdirSync(path.join(cwdA, 'sub'), { recursive: true })
  fs.mkdirSync(cwdB, { recursive: true })
  makeVersion(VER('1.0.0'))
  makeVersion(VER('2.0.0'))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('hostile script names', () => {
  before(() => record(entries([{ scope: 'user', installPath: VER('2.0.0'), version: '2.0.0' }])))
  const names = ['../probe', '..', 'a/b', 'a\\b', 'Probe', 'PROBE', 'probe.mjs', '', '-x', '1probe', 'nothere', 'x'.repeat(60), 'run', 'probe ', ' probe']
  for (const bad of names) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      const r = run('2.0.0', 'run.mjs', [bad])
      assert.notEqual(r.status, 0)
      assert.doesNotMatch(r.stdout, /probe:/)
      assert.match(r.stderr, /^aico run:/)
    })
  }
  test('no script name refuses', () => {
    const r = run('2.0.0', 'run.mjs', [])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /^aico run:/)
  })
})

describe('stale and active', () => {
  before(() => record(entries([{ scope: 'user', installPath: VER('2.0.0'), version: '2.0.0' }])))
  test('stale root refuses with exit 3 and both versions', () => {
    const r = run('1.0.0', 'run.mjs', ['probe'])
    assert.equal(r.status, 3)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /^aico run: stale plugin 1\.0\.0 active 2\.0\.0\n$/)
  })
  test('active root runs the script and passes args and exit code', () => {
    const r = run('2.0.0', 'run.mjs', ['probe', 'a', 'b'], { env: { PROBE_EXIT: '7' } })
    assert.equal(r.status, 7)
    assert.equal(r.stdout.trim(), 'probe:a,b')
  })
  test('plugin-root prints the active root', () => {
    const r = run('2.0.0', 'plugin-root.mjs')
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), VER('2.0.0'))
    assert.equal(run('1.0.0', 'plugin-root.mjs').status, 3)
  })
})

describe('project entry', () => {
  test('project entry for cwd beats user; a cwd below projectPath too', () => {
    record(entries([
      { scope: 'user', installPath: VER('2.0.0'), version: '2.0.0' },
      { scope: 'project', projectPath: cwdA, installPath: VER('1.0.0'), version: '1.0.0' }
    ]))
    assert.equal(run('1.0.0', 'run.mjs', ['probe'], { cwd: cwdA }).status, 0)
    assert.equal(run('1.0.0', 'run.mjs', ['probe'], { cwd: path.join(cwdA, 'sub') }).status, 0)
    assert.equal(run('2.0.0', 'run.mjs', ['probe'], { cwd: cwdA }).status, 3)
    assert.equal(run('2.0.0', 'run.mjs', ['probe'], { cwd: cwdB }).status, 0)
    assert.equal(run('1.0.0', 'run.mjs', ['probe'], { cwd: cwdB }).status, 3)
  })
  test('a sibling folder sharing a name prefix does not match', () => {
    fs.mkdirSync(cwdA + '-x', { recursive: true })
    assert.equal(run('2.0.0', 'run.mjs', ['probe'], { cwd: cwdA + '-x' }).status, 0)
  })
  test('the nearest ancestor project entry wins', () => {
    record(entries([
      { scope: 'project', projectPath: cwdA, installPath: VER('1.0.0'), version: '1.0.0' },
      { scope: 'project', projectPath: path.join(cwdA, 'sub'), installPath: VER('2.0.0'), version: '2.0.0' }
    ]))
    assert.equal(run('2.0.0', 'run.mjs', ['probe'], { cwd: path.join(cwdA, 'sub') }).status, 0)
  })
  test('case and slash differences are ignored on win32', { skip: !WIN }, () => {
    const odd = cwdA.toUpperCase().replaceAll('\\', '/')
    record(entries([{ scope: 'project', projectPath: odd, installPath: VER('1.0.0').toUpperCase(), version: '1.0.0' }]))
    assert.equal(run('1.0.0', 'run.mjs', ['probe']).status, 0)
  })
})

describe('unreadable record', () => {
  const good = () => ({ scope: 'user', installPath: VER('2.0.0'), version: '2.0.0' })
  const bad = (name, setup) => test(name, () => {
    fs.rmSync(RECORD(), { force: true, recursive: true })
    setup()
    const r = run('2.0.0', 'run.mjs', ['probe'])
    assert.equal(r.status, 3)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /^aico run: plugin record unreadable\n$/)
  })
  bad('missing', () => {})
  bad('a link or non-file', () => {
    const real = path.join(tmp, 'real.json')
    fs.writeFileSync(real, JSON.stringify(entries([good()])))
    fs.mkdirSync(path.dirname(RECORD()), { recursive: true })
    try { fs.symlinkSync(real, RECORD()) } catch { fs.mkdirSync(RECORD()) }
  })
  bad('a directory', () => fs.mkdirSync(RECORD(), { recursive: true }))
  bad('over the cap', () => record(JSON.stringify(entries([good()])) + ' '.repeat(1024 * 1024 + 1)))
  bad('bad JSON', () => record('{nope'))
  bad('wrong version', () => record({ version: 1, plugins: { 'plug@mk': [good()] } }))
  bad('no key', () => record({ version: 2, plugins: { 'other@mk': [good()] } }))
  bad('inherited key only', () => record('{"version":2,"plugins":{"__proto__":{"plug@mk":[]}}}'))
  bad('no matching entry', () => record(entries([{ scope: 'project', projectPath: cwdB, installPath: VER('2.0.0') }])))
  bad('entries not an array', () => record({ version: 2, plugins: { 'plug@mk': 'x' } }))
  bad('installPath missing', () => record(entries([{ scope: 'user', installPath: path.join(tmp, 'gone'), version: '9' }])))
  bad('installPath not a string', () => record(entries([{ scope: 'user', installPath: 5 }])))
  test('plugin.json name differing from the folder name', () => {
    const dir = path.join(home, '.claude', 'plugins', 'cache', 'mk', 'other', '1.0.0')
    makeVersion(dir, 'plug')
    record({ version: 2, plugins: { 'other@mk': [{ scope: 'user', installPath: dir }] } })
    const r = runAt(dir, 'run.mjs', ['probe'])
    assert.equal(r.status, 3)
    assert.match(r.stderr, /plugin record unreadable/)
  })
})

describe('outside the cache', () => {
  test('runs without reading the record', () => {
    const dir = path.join(tmp, 'checkout')
    makeVersion(dir)
    fs.rmSync(RECORD(), { force: true, recursive: true })
    const r = runAt(dir, 'run.mjs', ['probe', 'q'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), 'probe:q')
    const p = runAt(dir, 'plugin-root.mjs')
    assert.equal(fs.realpathSync(p.stdout.trim()), dir)
  })
  test('own root comes from the file location, not CLAUDE_PLUGIN_ROOT', () => {
    record(entries([{ scope: 'user', installPath: VER('2.0.0') }]))
    const r = run('1.0.0', 'run.mjs', ['probe'], { env: { CLAUDE_PLUGIN_ROOT: VER('2.0.0') } })
    assert.equal(r.status, 3)
  })
})
