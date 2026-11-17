// docs/contracts/mod-hook.md at v1.2: a missing or invalid snapshot is rebuilt on the first guarded call, and the
// guard denies `snapshot-invalid` only when the rebuild fails. Text checks on short phrases.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'contracts', 'mod-hook.md');
const text = fs.readFileSync(FILE, 'utf8');
const lines = text.split(/\r?\n/);
const step3 = lines.find((l) => /^3\. /.test(l)) ?? '';
const section = (name) => {
  const from = lines.findIndex((l) => l.startsWith(`## ${name}`));
  if (from === -1) return '';
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => l.startsWith('## '));
  return rest.slice(0, to === -1 ? undefined : to).join('\n');
};

describe('mod-hook v1.2 Contract text', () => {
  test('the heading is "# Contract: mod-hook v1.2"', () => {
    assert.equal(lines[0], '# Contract: mod-hook v1.2');
  });

  test('engine step 3 names a rebuild on the first guarded call', () => {
    assert.match(step3, /rebuil/i);
    assert.match(step3, /first guarded call/i);
  });

  test('engine step 3 denies snapshot-invalid only when the rebuild fails', () => {
    assert.match(step3, /snapshot-invalid/);
    assert.match(step3, /rebuild fail|fails to rebuild|rebuild cannot|only when/i);
    assert.doesNotMatch(step3, /unreadable or invalid → guards deny/);
  });

  test('both failed-rebuild causes are named: the model floor file and the settings', () => {
    assert.match(text, /snapshot rebuild failed/);
    assert.match(text, /model floor file unreadable/);
    assert.match(text, /settings invalid/);
  });

  test('the 200-character bound of the failed-rebuild message is stated', () => {
    assert.match(text, /200[- ]char|200 (printable )?char|at most 200 (printable )?char/i);
  });

  test('the escape names AICO_GUARDS=off for the failed-rebuild message', () => {
    assert.match(text, /snapshot rebuild failed[^\n]*AICO_GUARDS=off|AICO_GUARDS=off[^\n]*snapshot rebuild failed|restart the Lead with AICO_GUARDS=off/);
  });

  test('"until the session restarts" is gone', () => {
    assert.doesNotMatch(text, /until the session restarts/);
  });

  test('"a missing, partial or invalid file is" is gone', () => {
    assert.doesNotMatch(text, /a missing, partial or invalid file is/);
  });

  test('the Snapshot paragraph names the rebuild', () => {
    assert.match(section('Snapshot'), /rebuil/i);
  });

  test('Compatibility keeps the major rule (green before and after: characterization)', () => {
    const c = section('Compatibility');
    assert.match(c, /new verdict kind or a change in the engine order is a major/);
  });
});
