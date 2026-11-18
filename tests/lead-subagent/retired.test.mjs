// T7 (AC10, AC11): the lead_new_session path is retired. Fails while any trace of it is live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const NAME = ['lead', 'new', 'session'].join('_');
const LAUNCH = ['lead', 'launch', 'mcp'].join('-');
const norm = p => p.replaceAll(String.fromCharCode(92), '/');
// History is exempt (AC10).
const EXEMPT = [/^docs\/adr\//, /^CHANGELOG\.md$/, /^tests\/lead-handover\/evidence\.md$/, /^\.company\//, /^tests\/lead-subagent\/retired\.test\.mjs$/, /^docs\/specs\/P20261117\.000001~/];
const live = () => {
  const r = spawnSync('git', ['-C', root, 'ls-files', '--cached'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, 'git ls-files');
  return r.stdout.split('\n').map(norm).filter(f => f && existsSync(join(root, f)) && !EXEMPT.some(re => re.test(f)));
};

test('AC10: no file or folder named for lead_new_session or lead-launch-mcp remains', () => {
  const hits = live().filter(f => f.includes(NAME) || f.includes(LAUNCH));
  assert.deepEqual(hits, []);
});

test('AC10: no live file mentions lead_new_session (history exempt)', () => {
  const hits = live().filter(f => {
    try { return readFileSync(join(root, f), 'utf8').includes(NAME); } catch { return false; }
  });
  assert.deepEqual(hits, []);
});

test('AC10: plugin.json has no mcpServers entry', () => {
  const pj = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  assert.ok(!('mcpServers' in pj), 'mcpServers present');
});

test('AC10: no root .mcp.json', () => {
  assert.ok(!existsSync(join(root, '.mcp.json')));
});

test('AC10: package.json test script has no tests/lead-launch-mcp glob', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(!JSON.stringify(pkg).includes('tests/' + LAUNCH));
});

test('AC10: the retired folder and server script are gone', () => {
  assert.ok(!existsSync(join(root, 'tests', LAUNCH)));
  assert.ok(!existsSync(join(root, 'scripts', LAUNCH + '.mjs')));
});
