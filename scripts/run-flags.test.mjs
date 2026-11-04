// run.mjs forwards --disable-proto=delete to dashboard-server only.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-runflags-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
for (const f of ['run.mjs', 'plugin-root.mjs']) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dir, f))
const probe = 'console.log(JSON.stringify({ exec: process.execArgv, args: process.argv.slice(2) }))\n'
for (const f of ['dashboard-server.mjs', 'other.mjs']) fs.writeFileSync(path.join(dir, f), probe)

const run = (...a) => JSON.parse(spawnSync(process.execPath, [path.join(dir, 'run.mjs'), ...a], { encoding: 'utf8' }).stdout)

test('dashboard-server runs with --disable-proto=delete and keeps its args', () => {
  const r = run('dashboard-server', 'serve', '--lan', '--port', '1234')
  assert.deepEqual(r.exec, ['--disable-proto=delete'])
  assert.deepEqual(r.args, ['serve', '--lan', '--port', '1234'])
})

test('other scripts get no extra node flags', () => {
  assert.deepEqual(run('other', 'x').exec, [])
})
