import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('company types list grill once and no grilling', () => {
  for (const id of ['software', 'research', 'marketing', 'design']) {
    const m = JSON.parse(read(`company/types/${id}.json`));
    const n = m.playbooks.filter((p) => p === 'grill').length;
    assert.equal(n, 1, `${id}: grill listed ${n} times`);
    assert.ok(!m.playbooks.includes('grilling'), `${id}: grilling listed`);
    assert.ok(m.playbooks.includes('grill-me') && m.playbooks.includes('grill-with-docs'), id);
  }
});
