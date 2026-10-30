import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { missingSections } from './golden-warn.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'golden-warn.mjs');
const COMPLETE = '---\nrole: qa\n---\n## Did\n- x\n## Blocking\n- None.\n## Next\n- y\n';

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'golden-warn-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a fixture missing ## Next warns and exits 0', () => {
  const r = run({ 'a.md': COMPLETE.replace('## Next\n- y\n', '') });
  assert.equal(r.status, 0);
  assert.equal(r.out, 'warning: a.md missing ## Next\n');
});

test('a complete fixture prints nothing and exits 0', () => {
  const r = run({ 'a.md': COMPLETE });
  assert.equal(r.status, 0);
  assert.equal(r.out, '');
});

test('Summary stands in for Did; every missing section is named', () => {
  assert.deepEqual(missingSections('## Summary\n## Blocking\n## Next\n'), []);
  assert.deepEqual(missingSections('nothing\n'), ['Did', 'Blocking', 'Next']);
});

test('headings inside a code fence do not count; CRLF is tolerated', () => {
  assert.deepEqual(missingSections('## Did\r\n## Blocking\r\n```\n## Next\n```\n'), ['Next']);
});

test('only .md files are read; a missing directory exits 0 with a warning', () => {
  assert.equal(run({ 'a.txt': 'x' }).out, '');
  const r = spawnSync(process.execPath, [script, join(tmpdir(), 'no-such-golden-dir')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^warning: .* unreadable\n$/);
});
