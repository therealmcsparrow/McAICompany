import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { lookup } from './pr-links.mjs';

const SLUG = '2026-11-03 07.12 - Lead Session Mcp Connect';
const BRANCH = 'aico/2026-11-03-0712-lead-session-mcp-connect';

function makeRoot(t, names = [SLUG]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const n of names) fs.mkdirSync(path.join(root, '.company', 'work', n), { recursive: true });
  return root;
}

// behavior: { out, code, error, hang, stderr }
function fakeSpawn(t, behavior) {
  return t.mock.fn((cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = t.mock.fn(() => { child.killed = true; });
    setImmediate(() => {
      if (behavior.hang) return;
      if (behavior.error) return child.emit('error', Object.assign(new Error('spawn gh ENOENT'), { code: behavior.error }));
      if (behavior.stderr) child.stderr.emit('data', Buffer.from(behavior.stderr));
      if (behavior.out !== undefined) child.stdout.emit('data', Buffer.from(behavior.out));
      child.emit('close', behavior.code ?? 0);
    });
    return child;
  });
}

const url = (n, kind = 'pull') => `https://github.com/o/r/${kind}/${n}`;

test('found: prs in gh order, issues deduplicated, state lowercased', async (t) => {
  const root = makeRoot(t);
  const out = JSON.stringify([
    { number: 53, url: url(53), state: 'MERGED', closingIssuesReferences: [{ number: 12, url: url(12, 'issues') }] },
    { number: 54, url: url(54), state: 'OPEN', closingIssuesReferences: [{ number: 12, url: url(12, 'issues') }, { number: 13, url: url(13, 'issues') }] },
  ]);
  const spawn = fakeSpawn(t, { out });
  const r = await lookup(root, SLUG, { spawn });
  assert.deepEqual(r, {
    v: 1, slug: SLUG, branch: BRANCH, state: 'found',
    prs: [{ number: 53, url: url(53), state: 'merged' }, { number: 54, url: url(54), state: 'open' }],
    issues: [{ number: 12, url: url(12, 'issues') }, { number: 13, url: url(13, 'issues') }],
  });
  assert.equal(spawn.mock.callCount(), 1);
  const [cmd, args, opts] = spawn.mock.calls[0].arguments;
  assert.equal(cmd, 'gh');
  assert.deepEqual(args, ['pr', 'list', '--head', BRANCH, '--state', 'all', '--limit', '5', '--json', 'number,url,state,closingIssuesReferences']);
  assert.equal(opts.shell, false);
});

test('none: gh lists nothing', async (t) => {
  const root = makeRoot(t);
  const r = await lookup(root, SLUG, { spawn: fakeSpawn(t, { out: '[]' }) });
  assert.deepEqual(r, { v: 1, slug: SLUG, branch: BRANCH, state: 'none', prs: [], issues: [] });
});

test('drops bad rows: number, url, state; caps at 5', async (t) => {
  const root = makeRoot(t);
  const rows = [
    { number: -1, url: url(1), state: 'OPEN' },
    { number: 0, url: url(1), state: 'OPEN' },
    { number: '7', url: url(7), state: 'OPEN' },
    { number: 8, url: 'http://github.com/o/r/pull/8', state: 'OPEN' },
    { number: 9, url: 'https://evil.example/o/r/pull/9', state: 'OPEN' },
    { number: 10, url: url(10), state: 'DRAFT' },
    { number: 11, url: url(11), state: 'CLOSED', closingIssuesReferences: [{ number: 5, url: 'javascript:alert(1)' }, { number: -3, url: url(3, 'issues') }, { number: 6, url: url(6, 'issues'), extra: 'x' }] },
    { number: 12, url: url(12), state: 'OPEN', secret: 'x' },
  ];
  const r = await lookup(root, SLUG, { spawn: fakeSpawn(t, { out: JSON.stringify(rows) }) });
  assert.deepEqual(r.prs, [{ number: 11, url: url(11), state: 'closed' }, { number: 12, url: url(12), state: 'open' }]);
  assert.deepEqual(r.issues, [{ number: 6, url: url(6, 'issues') }]);
  assert.equal(r.state, 'found');
  const many = Array.from({ length: 8 }, (_, i) => ({ number: i + 1, url: url(i + 1), state: 'OPEN' }));
  const r2 = await lookup(root, SLUG, { spawn: fakeSpawn(t, { out: JSON.stringify(many) }) });
  assert.equal(r2.prs.length, 5);
});

test('unavailable: ENOENT, exit 1, timeout, bad JSON, non-array, oversize; no error text', async (t) => {
  const root = makeRoot(t);
  const cases = [
    { error: 'ENOENT' },
    { code: 1, stderr: 'gh: not logged in C:\\secret\\path token ghp_abc', out: '' },
    { hang: true },
    { out: 'not json' },
    { out: '{"a":1}' },
    { out: 'x'.repeat(1024 * 1024 + 1) },
  ];
  for (const behavior of cases) {
    const spawn = fakeSpawn(t, behavior);
    const r = await lookup(root, SLUG, { spawn, timeoutMs: 30 });
    assert.deepEqual(r, { v: 1, slug: SLUG, branch: BRANCH, state: 'unavailable', prs: [], issues: [] });
    const text = JSON.stringify(r);
    assert.ok(!/ghp_|secret|ENOENT|logged/.test(text));
  }
});

test('timeout kills the child', async (t) => {
  const root = makeRoot(t);
  const spawn = fakeSpawn(t, { hang: true });
  const r = await lookup(root, SLUG, { spawn, timeoutMs: 20 });
  assert.equal(r.state, 'unavailable');
  assert.equal(spawn.mock.callCount(), 1);
});

test('refused slugs: bad, wrong case, missing, non-string -> none, no gh call, slug not echoed', async (t) => {
  const root = makeRoot(t);
  const bad = ['--help', '../x', 'nope', '', undefined, null, 42, SLUG.toLowerCase(), SLUG.toUpperCase(), '2026-11-03 07.12 - Missing Run'];
  for (const slug of bad) {
    const spawn = fakeSpawn(t, { out: '[]' });
    const r = await lookup(root, slug, { spawn });
    assert.deepEqual(r, { v: 1, slug: null, branch: null, state: 'none', prs: [], issues: [] });
    assert.equal(spawn.mock.callCount(), 0);
  }
});

test('writes no file', async (t) => {
  const root = makeRoot(t);
  const list = () => fs.readdirSync(root, { recursive: true }).sort();
  const before = list();
  await lookup(root, SLUG, { spawn: fakeSpawn(t, { out: '[]' }) });
  await lookup(root, SLUG, { spawn: fakeSpawn(t, { error: 'ENOENT' }) });
  assert.deepEqual(list(), before);
});

test('cli: show --json prints the object and exits 0 for a refused slug', (t) => {
  const root = makeRoot(t);
  const script = path.join(import.meta.dirname, 'pr-links.mjs');
  const out = execFileSync(process.execPath, [script, 'show', 'nope', '--json'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { v: 1, slug: null, branch: null, state: 'none', prs: [], issues: [] });
});
