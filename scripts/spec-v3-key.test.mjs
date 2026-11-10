// Tests: destination-spec v1.5. A v3 run's committed spec is `docs/specs/<ProjectID>~<NN>-<playbook>.md` (the flat run
// key). `check` and `stamp` take it; every v1.4 refusal stays. Seams: spec-check main, work-folder slugOfKey.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as specCheck } from './spec-check.mjs';
import { slugOfKey } from '../mods/lib/work-folder.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const root = () => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-v3-key-')));
  tmps.push(d);
  return d;
};
const put = (cwd, rel, text = 'x\n') => {
  const file = path.join(cwd, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (cwd, rel) => fs.readFileSync(path.join(cwd, ...rel.split('/')), 'utf8');

const PID = 'P20261110.000001';
const SLUG = `${PID}/01-feature`;
const KEY = `${PID}~01-feature`;
const HEADINGS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
const spec = (slug) => `---\nslug: ${slug}\nversion: pending\nshipped: pending\n---\n${HEADINGS.map((h) => `${h}\nPlain words about the result.\n`).join('\n')}`;
const REFUSAL = 'refused: spec must be docs/specs/<name>.md or .company/work/<run>/spec.md';

test('slugOfKey: the key of a v3 run gives the run slug', () => {
  assert.equal(slugOfKey(KEY), SLUG);
});

test('spec-check check: a spec at docs/specs/<PID>~01-feature.md is clean, relative and absolute path', () => {
  const cwd = root();
  const rel = `docs/specs/${KEY}.md`;
  put(cwd, rel, spec(SLUG));
  assert.deepEqual(specCheck(['check', rel], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
  assert.deepEqual(specCheck(['check', path.join(cwd, ...rel.split('/'))], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
});

test('spec-check stamp: a v3 key spec is stamped, relative and absolute path, and only the two frontmatter lines change', () => {
  const cwd = root();
  const rel = `docs/specs/${KEY}.md`;
  const before = spec(SLUG);
  for (const arg of [rel, path.join(cwd, ...rel.split('/'))]) {
    put(cwd, rel, before);
    const r = specCheck(['stamp', arg, '--version', '1.2.3', '--date', '2026-11-10'], { root: cwd });
    assert.deepEqual(r, { code: 0, lines: [`stamped ${rel} 1.2.3 2026-11-10`] }, arg);
    const a = before.split('\n');
    const b = read(cwd, rel).split('\n');
    assert.equal(a.length, b.length);
    const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
    assert.deepEqual(changed, [2, 3]);
    assert.equal(b[2], 'version: 1.2.3');
    assert.equal(b[3], 'shipped: 2026-11-10');
  }
});

test('spec-check: a bad key or a wrong shape is still refused with exit 3 and the v1.4 line', () => {
  const cwd = root();
  const names = [
    `${PID}/01-feature`, // a subfolder, not a flat key
    `${PID.toLowerCase()}~01-feature`, // lower-case p
    `${PID}~01-Feature`,
    `${PID}~~01-feature`,
    `${PID}~01~feature`, // two ~
    '~01-feature', // empty ID
    `${PID}~`, // empty run part
    `${PID}~00-feature`, // parseRun refuses NN 00
    `${PID}~01-`,
    `${PID}~1-feature`,
  ];
  for (const n of names) {
    const rel = `docs/specs/${n}.md`;
    put(cwd, rel, spec(SLUG));
    assert.deepEqual(specCheck(['check', rel], { root: cwd }), { code: 3, lines: [REFUSAL] }, n);
    assert.deepEqual(specCheck(['stamp', rel, '--version', '1.2.3', '--date', '2026-11-10'], { root: cwd }), { code: 3, lines: [REFUSAL] }, `stamp ${n}`);
  }
});

test('spec-check: a key typed in another letter case than on disk is refused', () => {
  const cwd = root();
  put(cwd, `docs/specs/${KEY}.md`, spec(SLUG));
  for (const rel of [`docs/Specs/${KEY}.md`, `docs/specs/${KEY}.MD`, `docs/specs/${KEY.toUpperCase()}.md`, `docs/specs/${KEY.replace('P', 'p')}.md`]) {
    const r = specCheck(['check', rel], { root: cwd });
    assert.equal(r.code, 3, rel);
    assert.match(r.lines[0], /^refused: /, rel);
  }
});

test('spec-check: docs/specs/demo.md and a new-name spec are unchanged', () => {
  const cwd = root();
  put(cwd, 'docs/specs/demo.md', spec('demo'));
  put(cwd, 'docs/specs/P20261109.000009-15.52.35.md', spec('P20261109.000009-15.52.35'));
  assert.deepEqual(specCheck(['check', 'docs/specs/demo.md'], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
  assert.deepEqual(specCheck(['check', 'docs/specs/P20261109.000009-15.52.35.md'], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
});

test('text pins: destination-spec v1.5 paragraph names slugOfKey, spec-check header says v1.5, intake-and-ship names the path', () => {
  const contract = fs.readFileSync(path.join(REPO, 'docs/contracts/destination-spec.md'), 'utf8');
  const para = contract.split('\n').find((l) => /^v1\.5\b/.test(l));
  assert.ok(para, 'a v1.5 paragraph exists');
  assert.match(para, /slugOfKey/);
  const head = fs.readFileSync(path.join(REPO, 'scripts/spec-check.mjs'), 'utf8').split('\n').slice(0, 3).join('\n');
  assert.match(head, /destination-spec\.md v1\.5\b/);
  const ship = fs.readFileSync(path.join(REPO, 'skills/feature/references/intake-and-ship.md'), 'utf8');
  assert.ok(ship.includes('docs/specs/<ProjectID>~<NN>-<playbook>.md'));
});
