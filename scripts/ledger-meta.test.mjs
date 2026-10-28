import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateRecord, main } from './ledger.mjs';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const BASE_COMMIT = 'ad82a54';
const FAKE_HOME = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'ledger', 'claude-home');

// Every test works in its own temp dir; the plugin root is a temp dir too.
function sandbox(t, version = '0.17.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-meta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  if (version !== null) {
    fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version }));
  }
  return { dir, pluginRoot };
}

const call = (sb, args) => main(args, { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot });
const ledgerFile = (sb, name) => path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
const readLines = (sb, name) => fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeLedger = (sb, name, text) => {
  fs.mkdirSync(path.dirname(ledgerFile(sb, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, name), text);
};
const meta = (run, aico) => ({ v: 1, run, kind: 'meta', aico });

// ---------- schema, hostile cases first ----------

test('validateRecord refuses a meta record with a bad version text', () => {
  const bad = ['0.17', '0.17.0.1', '1000.1.1', '0.17.0-rc1', ' 0.17.0', '0.17.0\n', '../1.2.3', '', 17, null, ['0.17.0'], { a: 1 }];
  for (const aico of bad) assert.equal(validateRecord(meta('demo', aico)).ok, false, JSON.stringify(aico));
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'meta' }).ok, false);
});

test('validateRecord refuses extra keys on meta and the aico key on other kinds', () => {
  for (const key of ['id', 'role', 'src', 'acs', 'tokens', 'tier', 'note', '__proto__x']) {
    assert.equal(validateRecord({ ...meta('demo', '0.17.0'), [key]: 1 }).ok, false, key);
  }
  const note = { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 5 };
  assert.equal(validateRecord({ ...note, aico: '0.17.0' }).ok, false);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: 1, aico: '0.17.0' }).ok, false);
});

test('validateRecord accepts a meta record', () => {
  assert.equal(validateRecord(meta('demo', '0.17.0')).ok, true);
  assert.equal(validateRecord(meta('demo', '12.345.678')).ok, true);
  assert.equal(validateRecord({ ...meta('demo', '0.17.0'), v: 2 }).ok, false);
});

// ---------- ship writes the meta line ----------

test('ship writes the meta line just before the ship record', (t) => {
  const sb = sandbox(t);
  const r = call(sb, ['ship', 'demo', '3', '1', '0']);
  assert.equal(r.code, 0);
  const recs = readLines(sb, 'demo');
  assert.deepEqual(recs.map((x) => x.kind), ['meta', 'ship']);
  assert.deepEqual(recs[0], { v: 1, run: 'demo', kind: 'meta', aico: '0.17.0' });
  assert.equal(r.lines.length, 1, 'ship still prints exactly one line');
});

test('ship writes no meta line for brainstorm, replay and baseline runs', (t) => {
  const sb = sandbox(t);
  for (const run of ['brainstorm-20261028-1000', 'replay-x', 'baseline-y']) {
    assert.deepEqual(call(sb, ['ship', run, '2']).lines, ['ship recorded (excluded run)']);
    assert.deepEqual(readLines(sb, run).map((x) => x.kind), ['ship'], run);
  }
});

test('ship writes no meta line when plugin.json is missing, broken, or holds another version shape', (t) => {
  const odd = [null, '0.17', '0.17.0-beta', '1000.0.0', '', 17, ['0.17.0'], null];
  for (const version of odd) {
    const sb = sandbox(t, version);
    if (version === null) fs.rmSync(path.join(sb.pluginRoot, '.claude-plugin'), { recursive: true });
    const r = call(sb, ['ship', 'demo', '2']);
    assert.equal(r.code, 0, String(version));
    assert.deepEqual(readLines(sb, 'demo').map((x) => x.kind), ['ship'], String(version));
  }
  const sb = sandbox(t);
  fs.writeFileSync(path.join(sb.pluginRoot, '.claude-plugin', 'plugin.json'), '{ not json');
  assert.equal(call(sb, ['ship', 'demo', '2']).code, 0);
  assert.deepEqual(readLines(sb, 'demo').map((x) => x.kind), ['ship']);
});

test('ship reads only a bounded plugin.json and ignores an inherited version key', (t) => {
  const sb = sandbox(t);
  const file = path.join(sb.pluginRoot, '.claude-plugin', 'plugin.json');
  fs.writeFileSync(file, `{"version":"0.17.0","pad":"${'x'.repeat(200000)}"}`);
  assert.equal(call(sb, ['ship', 'big', '2']).code, 0);
  assert.deepEqual(readLines(sb, 'big').map((x) => x.kind), ['ship']);
  fs.writeFileSync(file, '{"__proto__":{"version":"9.9.9"}}');
  assert.equal(call(sb, ['ship', 'proto', '2']).code, 0);
  assert.deepEqual(readLines(sb, 'proto').map((x) => x.kind), ['ship']);
});

test('report and scorecard give the same numbers with or without the meta line', (t) => {
  const withMeta = sandbox(t);
  const without = sandbox(t, null);
  const note = { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 100 };
  const count = { ...note, src: 'transcript', tokens: { in: 10, cache_write: 20, cache_read: 5, out: 30 }, ctx_end: undefined };
  for (const sb of [withMeta, without]) writeLedger(sb, 'demo', `${JSON.stringify(note)}\n${JSON.stringify(count)}\n`);
  for (const sb of [withMeta, without]) call(sb, ['ship', 'demo', '2', '0', '0']);
  assert.equal(readLines(withMeta, 'demo').length, 4);
  assert.equal(readLines(without, 'demo').length, 3);
  for (const args of [['report', 'demo'], ['report', 'demo', '--json'], ['scorecard', 'demo']]) {
    const a = call(withMeta, args);
    const b = call(without, args);
    assert.deepEqual(a, b, args.join(' '));
    assert.equal(a.lines.some((l) => /warning: line|warnings: [1-9]/.test(l)), false);
  }
});

// ---------- a v1.1 reader skips the line ----------

test('the v1.1 script skips the meta line with one warning and keeps its numbers', (t) => {
  const sb = sandbox(t);
  // Git reads no user or system config: an empty per-test global file and no system file.
  const gitConfig = path.join(sb.dir, 'empty-gitconfig');
  fs.writeFileSync(gitConfig, '');
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
  const git = spawnSync('git', ['show', `${BASE_COMMIT}:scripts/ledger.mjs`], { cwd: import.meta.dirname, encoding: 'utf8', env: gitEnv });
  if (git.status !== 0) return t.skip('base script not available');
  const old = path.join(sb.dir, 'ledger-v11.mjs');
  const runState = pathToFileURL(path.join(import.meta.dirname, 'run-state.mjs')).href;
  fs.writeFileSync(old, git.stdout.replace("'./run-state.mjs'", JSON.stringify(runState)));
  const note = { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 100 };
  const count = { ...note, src: 'transcript', tokens: { in: 10, cache_write: 20, cache_read: 5, out: 30 }, ctx_end: undefined };
  const lines = [note, count, meta('demo', '0.17.0'), { v: 1, run: 'demo', kind: 'ship', acs: 2, fix_rounds: 0, high_blockers: 0 }];
  writeLedger(sb, 'demo', `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const noMeta = sandbox(t);
  writeLedger(noMeta, 'demo', `${[lines[0], lines[1], lines[3]].map((l) => JSON.stringify(l)).join('\n')}\n`);
  const env = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: FAKE_HOME, HOME: sb.dir, USERPROFILE: sb.dir };
  const read = (box) => spawnSync(process.execPath, [old, 'report', 'demo'], { cwd: box.dir, encoding: 'utf8', env });
  const a = read(sb);
  const b = read(noMeta);
  assert.equal(a.status, 0);
  assert.equal(a.stdout.split('\n').filter((l) => l.startsWith('warning: line 3 skipped')).length, 1);
  assert.equal(a.stdout.split('\n').filter((l) => l.startsWith('warning')).length, 1);
  assert.equal(a.stdout.replace(/warning: line 3 skipped\n/, ''), b.stdout);
});
