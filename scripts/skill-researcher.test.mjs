// Behaviour checks for the skillspector install constants and the skill-researcher registration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const INSTALL = [
  "uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'",
  'claude mcp add --scope user skillspector -- skillspector mcp',
];
const ROLLBACK = ['uv tool uninstall skillspector', 'claude mcp remove --scope user skillspector'];
test('AC10 the script constant prints the pinned install and rollback commands (install-commands --json)', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'skillspector.mjs'), 'install-commands', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.install, INSTALL);
  assert.deepEqual(j.rollback, ROLLBACK);
  assert.ok(read('scripts/skillspector.mjs').includes('v2.13.1'));
});

test('AC7 company/names.json names the skill-researcher Selin', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names['skill-researcher'], 'Selin');
});
