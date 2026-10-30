import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './handoff-lint.mjs';
import { loadGolden } from './contract-fixtures.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'golden');
const baseline = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
const goldens = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('pilot-')).sort();

// The ten Role types.
const ROLES = ['ai-data-engineer', 'architect', 'backend-engineer', 'code-reviewer', 'legal',
  'product-manager', 'qa', 'security', 'senior-engineer', 'writer'];

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'frontmatter block');
  const out = {};
  for (const line of m[1].split('\n')) {
    const k = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (k) out[k[1]] = k[2];
  }
  return out;
}

test('AC27 one golden Handoff per Role type', () => {
  assert.deepEqual(goldens, ROLES.map((r) => `${r}.md`));
});

for (const file of goldens) {
  const text = readFileSync(join(dir, file), 'utf8');
  const role = file.replace(/\.md$/, '');

  test(`AC27 ${file}: LF only, final newline (proj.M11)`, () => {
    assert.ok(!text.includes('\r'));
    assert.ok(text.endsWith('\n'));
  });

  test(`AC27 ${file}: Handoff shape`, () => {
    const fm = frontmatter(text);
    assert.equal(fm.role, role);
    assert.match(fm.status, /^(done|blocked|needs-ceo|handover)\b/);
    assert.match(text, /^## (Did|Summary)$/m);
  });

  test(`AC27 ${file}: size matches baseline`, () => {
    const b = baseline.files[file];
    assert.ok(b, 'baseline entry');
    assert.equal(Buffer.byteLength(text), b.bytes);
    assert.equal(text.split('\n').length - 1, b.lines);
  });
}

test('AC27 baseline holds counts only', () => {
  assert.deepEqual(Object.keys(baseline.files).sort(), goldens);
  for (const v of Object.values(baseline.files)) {
    assert.deepEqual(Object.keys(v).sort(), ['bytes', 'lines']);
    assert.ok(Number.isInteger(v.bytes) && v.bytes > 0);
    assert.ok(Number.isInteger(v.lines) && v.lines > 0);
  }
  assert.ok(!readFileSync(join(dir, 'baseline.json'), 'utf8').includes('\r'));
});

describe('handoff Contract fixtures', () => {
  const fixtures = loadGolden('handoff');
  const cases = fixtures.json('cases.json');

  test('fixtures are stamped with the Contract version', () => {
    assert.match(fixtures.version, /^\d+\.\d+$/);
  });

  for (const [name, c] of Object.entries(cases)) {
    test(`lint: ${name}`, () => {
      const text = fixtures.text(c.file);
      assert.ok(!text.includes('\r'), 'LF only');
      assert.ok(text.endsWith('\n'));
      const { errors, routing } = lint(text);
      if (c.errors) assert.deepEqual(errors, c.errors);
      if (c.routing) {
        assert.deepEqual(errors, []);
        const { top, ...rest } = routing;
        assert.deepEqual(rest, c.routing);
        assert.ok(top);
      }
    });
  }
});
