import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This repo is the plugin source AND a product folder. Claude Code reads the root `.mcp.json` twice:
//   1. as the plugin's registration (`plugin:aico:lead-session`), CLAUDE_PLUGIN_ROOT set -> connects;
//   2. as the project-scope file of the session cwd (`lead-session`), CLAUDE_PLUGIN_ROOT NOT set -> the
//      args stay `${CLAUDE_PLUGIN_ROOT}/scripts/...` (or expand to an empty prefix), node exits 1,
//      the client shows `lead-session (CONNECTION_CLOSED)`.
// Fix-agnostic: the root file may change (a `${VAR:-default}` fallback) or go away (registration moves to
// plugin.json `mcpServers`); in every case no server Claude Code can load from the repo root may die at start.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const MCP = path.join(repo, '.mcp.json');

// Claude Code env expansion in .mcp.json: `${VAR}` and `${VAR:-default}`. An unset `${VAR}` stays as written here
// (the client either keeps it or reports a missing variable; both leave no working server).
function expand(s, env) {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name, def) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    return def !== undefined ? def : whole;
  });
}

const rpc = (id, method, params) => `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;

describe('project-scope load of the root .mcp.json (cwd = this repo, CLAUDE_PLUGIN_ROOT unset)', () => {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;

  test('every server in the root .mcp.json starts and answers initialize, exit 0', { skip: !fs.existsSync(MCP) && 'no root .mcp.json' }, () => {
    const j = JSON.parse(fs.readFileSync(MCP, 'utf8'));
    const names = Object.keys(j.mcpServers);
    assert.ok(names.length > 0);
    for (const name of names) {
      const s = j.mcpServers[name];
      const args = s.args.map((a) => expand(a, env));
      const r = spawnSync(expand(s.command, env), args, {
        cwd: repo, env, encoding: 'utf8', timeout: 10000,
        input: rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }),
      });
      assert.equal(r.error, undefined, `${name}: ${r.error}`);
      assert.equal(r.status, 0, `${name}: exit ${r.status} for args ${JSON.stringify(args)}\n${r.stderr.split('\n')[0]}`);
      const m = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
      assert.equal(m.id, 1, name);
      assert.equal(m.result.serverInfo.name, 'lead-session', name);
    }
  });

  test('the same file still resolves once CLAUDE_PLUGIN_ROOT is the plugin folder (plugin scope)', { skip: !fs.existsSync(MCP) && 'no root .mcp.json' }, () => {
    const j = JSON.parse(fs.readFileSync(MCP, 'utf8'));
    const penv = { ...env, CLAUDE_PLUGIN_ROOT: repo };
    for (const [name, s] of Object.entries(j.mcpServers)) {
      for (const a of s.args) {
        const p = expand(a, penv);
        assert.doesNotMatch(p, /\$\{/, `${name}: unexpanded variable in ${a}`);
        assert.ok(fs.existsSync(path.resolve(repo, p)), `${name}: ${a} does not exist`);
      }
    }
  });

  test('without a root .mcp.json the plugin must still register lead-session (plugin.json mcpServers)', () => {
    assert.equal(fs.existsSync(MCP), false, 'a root .mcp.json is read twice in this repo and dies at project scope; register in plugin.json');
    const pj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.ok(pj.mcpServers && pj.mcpServers['lead-session'], 'lead-session registered nowhere');
  });
});
