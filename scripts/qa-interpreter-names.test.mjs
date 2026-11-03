// Bare `node` interpreter inventory and win32 cwd-lookup probes.
// Every place a plugin config names its interpreter must be known here; a new one needs a security look.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))

test('inventory: hooks name `node` with a quoted plugin-root script, nothing else', () => {
  const hooks = json('hooks/hooks.json').hooks
  const cmds = Object.values(hooks).flat().flatMap((g) => g.hooks).map((h) => h.command)
  assert.ok(cmds.length >= 8)
  for (const c of cmds) assert.match(c, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[\w-]+\.mjs"( [\w-]+)?$/, c)
})

test('inventory: the only plugin MCP server is lead-session, `node` + plugin-root script', () => {
  const m = json('.claude-plugin/plugin.json').mcpServers
  assert.deepEqual(Object.keys(m), ['lead-session'])
  assert.equal(m['lead-session'].command, 'node')
  assert.deepEqual(m['lead-session'].args, ['${CLAUDE_PLUGIN_ROOT}/scripts/lead-launch-mcp.mjs'])
})

test('inventory: no other plugin-level config files name an interpreter', () => {
  for (const f of ['.mcp.json', 'hooks/hooks.local.json']) {
    assert.throws(() => readFileSync(join(root, f)), { code: 'ENOENT' }, f)
  }
})

// Probes: a copy of the real node.exe sits in a temp cwd and reports its own path.
// The copy is harmless (same binary); a hijack shows as execPath inside the temp dir.
const ND = 'NoDefaultCurrentDirectoryInExePath'
// libuv reads the PARENT's env for the lookup, so the parent env is controlled here and restored.
const withParentNd = (value, fn) => {
  const saved = process.env[ND]
  if (value === undefined) delete process.env[ND]; else process.env[ND] = value
  try { return fn() } finally { if (saved === undefined) delete process.env[ND]; else process.env[ND] = saved }
}

test('win32 probe: direct spawn of `node` is no guard; only ND=1 in the parent stops the cwd copy (hazard + guard)', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'aico-node-probe-'))
  try {
    copyFileSync(process.execPath, join(dir, 'node.exe'))
    const run = (nd) => withParentNd(nd, () => spawnSync('node', ['-p', 'process.execPath'], { cwd: dir, encoding: 'utf8' }).stdout.trim().toLowerCase())
    assert.ok(!run('1').startsWith(dir.toLowerCase()), 'ND=1 in the parent must stop the cwd lookup')
    // Hazard: without ND=1 in the parent, the cwd copy wins even for a direct spawn.
    assert.ok(run(undefined).startsWith(dir.toLowerCase()), 'without ND=1 a direct spawn picks the cwd node.exe')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('win32 probe: cmd.exe honours NoDefaultCurrentDirectoryInExePath=1', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'aico-node-probe-'))
  try {
    writeFileSync(join(dir, 'node.cmd'), '@echo HIJACK\r\n')
    const run = (nd) => {
      const env = { ...process.env }
      delete env[ND]
      if (nd) env[ND] = '1'
      return spawnSync('node -p "process.execPath"', { cwd: dir, env, shell: true, encoding: 'utf8' }).stdout
    }
    assert.ok(!run(true).includes('HIJACK'), 'ND=1 must stop the cwd lookup')
    // Documents the underlying hazard so the guard above is not vacuous.
    assert.ok(run(false).includes('HIJACK'), 'without ND=1 cmd.exe runs node.cmd from the cwd')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
