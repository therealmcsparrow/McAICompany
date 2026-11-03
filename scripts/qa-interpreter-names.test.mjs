// Bare `node` interpreter inventory and win32 cwd-lookup probes (run 2026-11-03 lead-session-mcp-connect).
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
test('win32 probe: direct spawn of `node` ignores the cwd (how MCP servers start)', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'aico-node-probe-'))
  try {
    copyFileSync(process.execPath, join(dir, 'node.exe'))
    const env = { ...process.env }
    delete env.NoDefaultCurrentDirectoryInExePath
    const r = spawnSync('node', ['-p', 'process.execPath'], { cwd: dir, env, encoding: 'utf8' })
    assert.ok(!r.stdout.trim().toLowerCase().startsWith(dir.toLowerCase()), r.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('win32 probe: cmd.exe honours NoDefaultCurrentDirectoryInExePath=1 (Claude Code sets it for children)', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'aico-node-probe-'))
  try {
    writeFileSync(join(dir, 'node.cmd'), '@echo HIJACK\r\n')
    const run = (nd) => {
      const env = { ...process.env }
      delete env.NoDefaultCurrentDirectoryInExePath
      if (nd) env.NoDefaultCurrentDirectoryInExePath = '1'
      return spawnSync('node -p "process.execPath"', { cwd: dir, env, shell: true, encoding: 'utf8' }).stdout
    }
    assert.ok(!run(true).includes('HIJACK'), 'ND=1 must stop the cwd lookup')
    // Documents the underlying hazard so the guard above is not vacuous.
    assert.ok(run(false).includes('HIJACK'), 'without ND=1 cmd.exe runs node.cmd from the cwd')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
