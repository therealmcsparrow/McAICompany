import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Dispatch examples under tests/ keep a valid cap line (95000 is still a cap) and no Name: line.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const OLD_LINE = 'Context cap: 95000 handover 85500';

test('dispatch examples stay valid: 95000 is still a cap and there is no Name: line', () => {
  for (const p of ['tests/regression/dispatch-ok.md', 'tests/regression/dispatch-no-language.md', 'tests/contracts/dispatch-prompt/step.txt']) {
    const t = read(p);
    assert.ok(t.includes(OLD_LINE), `missing cap line in ${p}`);
    for (const n of ['150000', '120000']) assert.ok(!t.includes(n), `${p} holds ${n}`);
    assert.ok(!/^Name:/m.test(t), `${p} has a Name: line`);
  }
});
