// draft-input v1.8: `arg` and `take --for to-spec` accept a v3 run's shipped spec, docs/specs/<ProjectID>~<NN>-<playbook>.md.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const PID = 'P20261110.000001';
const KEY = `${PID}~01-feature`;
const REL = `docs/specs/${KEY}.md`;
const NOW = new Date();
const BS = String.fromCharCode(92);

const HEADS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
const SPEC = ['---', 'slug: demo', 'version: pending', 'shipped: pending', '---', '', ...HEADS.flatMap((h) => [h, 'Plain words about the result.', ''])].join('\n');

function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-spec-key-')));
  made.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function arg(root, text) {
  put(root, '.company/draft-input-arg-to-spec.txt', text);
  return main(['arg', '--for', 'to-spec'], { root, now: NOW });
}
const take = (root, p) => main(['take', p, '--for', 'to-spec'], { root, now: NOW });
const refused = (r, why) => assert.deepEqual(r, { code: 3, lines: [`refused: ${why}`] });

describe('v3 run spec key path (draft-input v1.8)', () => {
  test('arg prints arg: file with the key path', () => {
    const root = fixture({ [REL]: SPEC });
    assert.deepEqual(arg(root, REL), { code: 0, lines: [`arg: file ${REL}`] });
  });

  test('arg prints the backslash form with /', () => {
    const root = fixture({ [REL]: SPEC });
    assert.deepEqual(arg(root, REL.replaceAll('/', BS)), { code: 0, lines: [`arg: file ${REL}`] });
  });

  test('take exits 0 with slug, input, kind: spec and writes input-to-spec.md', () => {
    const root = fixture({ [REL]: SPEC });
    const r = take(root, REL);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines[0].startsWith('slug: '));
    assert.ok(r.lines[1].startsWith('input: '));
    assert.ok(r.lines.includes('kind: spec'));
    const copy = path.join(root, ...r.lines[1].slice('input: '.length).split('/'));
    assert.equal(fs.readFileSync(copy, 'utf8'), SPEC);
    assert.ok(copy.endsWith('input-to-spec.md'));
  });

  test('take takes the backslash form', () => {
    const root = fixture({ [REL]: SPEC });
    const r = take(root, REL.replaceAll('/', BS));
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines.includes('kind: spec'));
  });

  const BAD = {
    'two ~': `docs/specs/${PID}~01~feature.md`,
    'empty ID': 'docs/specs/~01-feature.md',
    'empty run part': `docs/specs/${PID}~.md`,
    'lower-case p ID': `docs/specs/p20261110.000001~01-feature.md`,
    '01-Feature': `docs/specs/${PID}~01-Feature.md`,
    'a key parseRun refuses': `docs/specs/${PID}~1-feature.md`,
    'a / before the key': `docs/specs/x/${KEY}.md`,
    'a ~ name outside docs/specs/': `docs/other/${KEY}.md`,
    'Docs/specs/ in another case': `Docs/specs/${KEY}.md`,
  };
  for (const [label, rel] of Object.entries(BAD)) {
    test(`take refuses ${label}`, () => {
      const root = fixture({ [rel]: SPEC });
      refused(take(root, rel), 'path bad character');
    });
    test(`arg refuses ${label} as a path`, () => {
      const root = fixture({ [rel]: SPEC });
      const r = arg(root, rel);
      assert.ok(!r.lines.includes(`arg: file ${rel}`), r.lines.join('\n'));
    });
  }

  test('docs/specs/run.md is taken as today', () => {
    const root = fixture({ 'docs/specs/run.md': SPEC });
    const r = take(root, 'docs/specs/run.md');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines.includes('kind: spec'));
  });

  test('stale on the key spec is refused: not a plan', () => {
    const root = fixture({ [REL]: SPEC });
    refused(main(['stale', REL], { root }), 'not a plan');
  });
});
