// Tests for the run-named files of a v3 run: token-ledger, release (gate report), reflect, pr-links.
// A v3 slug `<ID>/<NN>-<pb>` names its file with `runKey` (`<ID>~<NN>-<pb>`, never a `/`); two runs of one project never share
// a file; a ledger file name is read back as its slug (`slugOfKey`); v2, v1.1 and legacy names keep today's output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { main as ledger } from './ledger.mjs';
import { gateReport, runsOf } from './gate-report.mjs';
import { lookup } from './pr-links.mjs';

const PROJ = 'P20261109.000009';
const R1 = `${PROJ}/01-feature`;
const R3 = `${PROJ}/03-fix`;
const K1 = `${PROJ}~01-feature`;
const K3 = `${PROJ}~03-fix`;
const V2 = 'P20261101.000001-09.30.00';
const LEGACY = 'old-run-one';
const NOW = Date.parse('2026-11-09T12:00:00Z');
const AGENT = 'aaaaaaaaaaaa';
const reflectScript = path.join(import.meta.dirname, 'reflect.mjs');

function makeRoot(t, slugs = [R1, R3]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-key-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const s of [...slugs, V2, LEGACY]) fs.mkdirSync(path.join(root, '.company', 'work', s), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', PROJ, '00-project.md'), 'Run key files\n');
  return root;
}

const ledgerDir = (root) => path.join(root, '.company', 'ledger');
const filesOf = (root) => fs.readdirSync(ledgerDir(root)).sort();
const add = (root, run, id = '01') => ledger(['add', run, 'step', id, 'architect', AGENT, '1000'], { root, now: NOW });

function seed(root, file, run, aico) {
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  const rows = [{ v: 1, run, kind: 'meta', aico }, { v: 1, run, kind: 'ship', acs: 2, fix_rounds: 0 }];
  fs.writeFileSync(path.join(ledgerDir(root), file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---------- token-ledger ----------

test('ledger add of a v3 run writes <ID>~<NN>-<pb>.jsonl, flat, no sub folder', (t) => {
  const root = makeRoot(t);
  const r = add(root, R1);
  assert.equal(r.code, 0, JSON.stringify(r.lines));
  assert.deepEqual(filesOf(root), [`${K1}.jsonl`]);
  assert.ok(fs.statSync(path.join(ledgerDir(root), `${K1}.jsonl`)).isFile());
});

test('two runs of one project write two files and never share one', (t) => {
  const root = makeRoot(t);
  assert.equal(add(root, R1, '01').code, 0);
  assert.equal(add(root, R3, '02').code, 0);
  assert.equal(add(root, R1, '03').code, 0);
  assert.deepEqual(filesOf(root), [`${K1}.jsonl`, `${K3}.jsonl`]);
  const lines = (k) => fs.readFileSync(path.join(ledgerDir(root), `${k}.jsonl`), 'utf8').trim().split('\n');
  assert.equal(lines(K1).length, 2);
  assert.equal(lines(K3).length, 1);
  for (const l of [...lines(K1), ...lines(K3)]) assert.ok([R1, R3].includes(JSON.parse(l).run), l);
});

test('ledger report of a v3 slug reads its own runKey file only', (t) => {
  const root = makeRoot(t);
  add(root, R1);
  const own = ledger(['report', R1, '--json'], { root, now: NOW });
  assert.equal(own.code, 0, JSON.stringify(own.lines));
  const data = JSON.parse(own.lines.join('\n'));
  assert.equal(data.run, R1);
  assert.ok(!data.warnings.includes('no ledger'), own.lines.join('\n'));
  assert.ok(data.rows.length >= 1);
  const other = JSON.parse(ledger(['report', R3, '--json'], { root, now: NOW }).lines.join('\n'));
  assert.ok(other.warnings.includes('no ledger'), 'the sibling run has no file of its own');
});

test('a v3 slug never reaches the disk as a path with a slash in the ledger folder', (t) => {
  const root = makeRoot(t);
  add(root, R1);
  assert.ok(!fs.existsSync(path.join(ledgerDir(root), PROJ)), 'no <ID>/ folder under .company/ledger');
});

test('v2 and legacy names keep their own file names', (t) => {
  const root = makeRoot(t);
  assert.equal(add(root, V2).code, 0);
  assert.equal(add(root, LEGACY).code, 0);
  assert.deepEqual(filesOf(root), [`${LEGACY}.jsonl`, `${V2}.jsonl`].sort());
});

test('ledger refuses a v3 slug with a second slash or a tilde key typed as the run', (t) => {
  const root = makeRoot(t);
  assert.equal(add(root, `${R1}/x`).code, 2);
  assert.equal(add(root, K1).code, 2, 'a key is a file name, not an accepted slug');
  assert.ok(!fs.existsSync(ledgerDir(root)) || filesOf(root).length === 0);
});

// ---------- release: gate report runs ----------

test('gate report lists a v3 ledger file as its slug', (t) => {
  const root = makeRoot(t);
  seed(root, `${K3}.jsonl`, R3, '0.33.0');
  assert.deepEqual(runsOf(root, '0.33.0').map((r) => r.run), [R3]);
  const text = gateReport({ root, version: '0.33.0' });
  assert.match(text, new RegExp(`### ${R3.replace('.', '\\.')}\\n`));
  assert.ok(!text.includes(K3), 'the key never shows in the report');
});

test('two runs of one project are two sections of the gate report', (t) => {
  const root = makeRoot(t);
  seed(root, `${K1}.jsonl`, R1, '0.33.0');
  seed(root, `${K3}.jsonl`, R3, '0.33.0');
  assert.deepEqual(runsOf(root, '0.33.0').map((r) => r.run).sort(), [R1, R3]);
  assert.match(gateReport({ root, version: '0.33.0' }), /Runs: 2/);
});

test('gate report skips a name with a second tilde or a slash-like part, and a v3 run of another version', (t) => {
  const root = makeRoot(t);
  seed(root, `${PROJ}~01-a~02-b.jsonl`, R1, '0.33.0');
  seed(root, `${PROJ}~..-fix.jsonl`, R1, '0.33.0');
  seed(root, `${K1}.jsonl`, R1, '0.32.0');
  assert.deepEqual(runsOf(root, '0.33.0'), []);
});

test('gate report keeps v2 and legacy names as they are beside a v3 file', (t) => {
  const root = makeRoot(t);
  seed(root, `${V2}.jsonl`, V2, '0.33.0');
  seed(root, `${LEGACY}.jsonl`, LEGACY, '0.33.0');
  seed(root, `${K1}.jsonl`, R1, '0.33.0');
  assert.deepEqual(runsOf(root, '0.33.0').map((r) => r.run).sort(), [R1, LEGACY, V2].sort());
});

// ---------- ledger scorecard compares against v3 files ----------

test('a legacy run scorecard counts a shipped v3 file as one comparison run and does not throw', (t) => {
  const root = makeRoot(t);
  const shipRec = (run, t1, t2) => ({ v: 1, run, kind: 'ship', acs: 2, fix_rounds: 0, t_start: t1, t_ship: t2 });
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  const write = (file, rows) => fs.writeFileSync(path.join(ledgerDir(root), file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  write(`${K1}.jsonl`, [shipRec(R1, '2026-11-08T09:00:00Z', '2026-11-08T10:00:00Z')]);
  write(`${LEGACY}.jsonl`, [shipRec(LEGACY, '2026-11-09T09:00:00Z', '2026-11-09T09:30:00Z')]);
  const r = ledger(['scorecard', LEGACY], { root, now: NOW });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.ok(!/no baseline/.test(r.lines.join('\n')), `the v3 file is a baseline run: ${r.lines.join('\n')}`);
});

// ---------- reflect ----------

function reflect(root, ...args) {
  const r = spawnSync(process.execPath, [reflectScript, ...args], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

test('reflect retro of a v3 slug reads its runKey ledger file', (t) => {
  const root = makeRoot(t);
  add(root, R1);
  const r = reflect(root, 'retro', R1, '--json');
  assert.equal(r.status, 0, r.out + r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.slug, R1);
  assert.ok(!data.warnings.includes('no ledger'), r.out);
});

test('reflect retro of a sibling run does not read the other run file', (t) => {
  const root = makeRoot(t);
  add(root, R1);
  const r = reflect(root, 'retro', R3, '--json');
  assert.equal(r.status, 0, r.out + r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.slug, R3);
  assert.ok(data.warnings.includes('no ledger'), r.out);
});

test('reflect retro of a legacy run is unchanged', (t) => {
  const root = makeRoot(t);
  add(root, LEGACY);
  const r = reflect(root, 'retro', LEGACY, '--json');
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(JSON.parse(r.out).slug, LEGACY);
});

// ---------- pr-links ----------

function fakeSpawn(t, out) {
  return t.mock.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(out));
      child.emit('close', 0);
    });
    return child;
  });
}

test('pr-links lookup of a v3 slug keeps the slug and asks for the project branch', async (t) => {
  const root = makeRoot(t);
  const out = JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', closingIssuesReferences: [] }]);
  const spawn = fakeSpawn(t, out);
  const r = await lookup(root, R1, { spawn });
  assert.equal(r.state, 'found');
  assert.equal(r.slug, R1);
  assert.equal(r.branch, `aico/${PROJ}`);
  assert.equal(spawn.mock.callCount(), 1);
  assert.deepEqual(spawn.mock.calls[0].arguments[1].slice(0, 4), ['pr', 'list', '--head', `aico/${PROJ}`]);
});

test('pr-links refuses a v3 slug with no folder, a second slash or a runKey', async (t) => {
  const root = makeRoot(t);
  for (const bad of [`${PROJ}/09-gone`, `${R1}/x`, K1]) {
    const spawn = fakeSpawn(t, '[]');
    const r = await lookup(root, bad, { spawn });
    assert.equal(r.state, 'none', bad);
    assert.equal(r.slug, null, bad);
    assert.equal(spawn.mock.callCount(), 0, bad);
  }
});

test('pr-links lookup of a v2 name is unchanged', async (t) => {
  const root = makeRoot(t);
  const r = await lookup(root, V2, { spawn: fakeSpawn(t, '[]') });
  assert.equal(r.slug, V2);
  assert.equal(r.state, 'none');
  assert.match(r.branch, /^aico\/P20261101\.000001/);
});
