import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Data checks for the research skill group and the plugin's dependency list.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('AC7 research group holds find-skills with license and vetted, core includes it', () => {
  const b = JSON.parse(read('deps/3rdpartyskills.json'));
  assert.ok(b.groups.core.some((e) => e.include === 'research'));
  assert.ok(Array.isArray(b.groups.research) && b.groups.research.length >= 1);
  for (const n of b.groups.research) {
    const e = b.entries.find((x) => x.skillname === n);
    assert.ok(e && e.license && e.vetted, `research entry ${n} needs license and vetted`);
    assert.ok(!/api[-_ ]?key/i.test(JSON.stringify(e)));
  }
  assert.ok(b.groups.research.includes('find-skills'));
});

test('aico depends on no mattpocock-skills plugin', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.ok(!plugin.dependencies.some((d) => d.startsWith('mattpocock-skills')));
});
