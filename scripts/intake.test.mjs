import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listIntake, main } from './intake.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const dir = () => path.join(root, '.company', 'intake');
const file = () => path.join(dir(), 'intake.jsonl');

function run(args, now = NOW) {
  let out = '';
  const code = main(args, { root, now, out: s => { out += s; } });
  return { code, out };
}
const rec = (o = {}) => JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'needs-info', topic: 'Login Fix', ...o });
function seed(lines) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), lines.map(l => `${l}\n`).join(''));
}
const idOf = out => /^id: ([0-9a-f]{12})$/m.exec(out)[1];

describe('add, set, list', () => {
  test('missing file gives an empty list', () => {
    assert.deepEqual(listIntake(root, { now: NOW }), { v: 1, items: [], warnings: [] });
    const r = run(['list', '--json']);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { v: 1, items: [], warnings: [] });
  });

  test('add then list gives one needs-info item', () => {
    const a = run(['add', 'needs-info', 'Login Fix']);
    assert.equal(a.code, 0);
    const id = idOf(a.out);
    const l = JSON.parse(run(['list', '--json']).out);
    assert.deepEqual(l.items, [{ id, outcome: 'needs-info', topic: 'Login Fix', slug: null, at: iso(NOW) }]);
  });

  test('set updates the outcome and keeps one item per id', () => {
    const id = idOf(run(['add', 'needs-info', 'Login Fix']).out);
    const slug = '2026-11-04 12.00 - Login Fix';
    const s = run(['set', id, 'intake', slug], NOW + 1000);
    assert.equal(s.code, 0);
    const items = listIntake(root, { now: NOW + 1000 }).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].outcome, 'intake');
    assert.equal(items[0].slug, slug);
    assert.equal(items[0].topic, 'Login Fix');
  });

  test('list is newest first and capped at 200', () => {
    const lines = [];
    for (let i = 0; i < 250; i++) lines.push(rec({ id: i.toString(16).padStart(12, '0'), at: iso(NOW - i * 1000) }));
    seed(lines.slice(0, 250));
    // the file limit is 1000 lines; 250 lines of ~100 bytes stay under 64 KiB
    const items = listIntake(root, { now: NOW }).items;
    assert.equal(items.length, 200);
    assert.equal(items[0].id, '000000000000');
    assert.ok(items[0].at >= items[1].at);
  });

  test('set on an unknown id is refused', () => {
    run(['add', 'intake', 'Login Fix']);
    const r = run(['set', '112233445566', 'rejected']);
    assert.equal(r.code, 2);
    assert.equal(r.out.trim(), 'refused: unknown id');
  });

  test('writes the .gitignore with exactly * and LF, and rewrites a differing one', () => {
    run(['add', 'intake', 'Login Fix']);
    const g = path.join(dir(), '.gitignore');
    assert.equal(fs.readFileSync(g, 'utf8'), '*\n');
    fs.writeFileSync(g, 'nothing\n');
    run(['add', 'intake', 'Login Fix']);
    assert.equal(fs.readFileSync(g, 'utf8'), '*\n');
  });

  test('file is LF only', () => {
    run(['add', 'intake', 'Login Fix']);
    assert.ok(!fs.readFileSync(file(), 'utf8').includes('\r'));
  });
});

describe('retention', () => {
  test('an id last changed 91 days ago is dropped on the next write', () => {
    seed([rec({ id: '111111111111', at: iso(NOW - 91 * DAY) }), rec({ id: '222222222222', at: iso(NOW - 89 * DAY) }), 'garbage']);
    run(['add', 'intake', 'Other Thing']);
    const ids = fs.readFileSync(file(), 'utf8').trim().split('\n').map(l => JSON.parse(l).id);
    assert.ok(!ids.includes('111111111111'));
    assert.ok(ids.includes('222222222222'));
    assert.equal(ids.length, 2);
  });

  test('the whole history of an old id goes, not only its latest line', () => {
    seed([rec({ id: '111111111111', at: iso(NOW - 120 * DAY) }), rec({ id: '111111111111', at: iso(NOW - 91 * DAY), outcome: 'rejected' })]);
    run(['add', 'intake', 'Other Thing']);
    assert.equal(fs.readFileSync(file(), 'utf8').trim().split('\n').length, 1);
  });

  test('list leaves out an id older than 90 days without writing', () => {
    seed([rec({ at: iso(NOW - 91 * DAY) })]);
    const before = fs.readFileSync(file(), 'utf8');
    assert.deepEqual(listIntake(root, { now: NOW }).items, []);
    assert.equal(fs.readFileSync(file(), 'utf8'), before);
  });

  test('set of an id that was pruned is unknown', () => {
    seed([rec({ id: '111111111111', at: iso(NOW - 91 * DAY) })]);
    assert.equal(run(['set', '111111111111', 'intake']).out.trim(), 'refused: unknown id');
  });
});

describe('refusals', () => {
  const cases = [
    [['add', 'maybe', 'Login Fix'], 'bad outcome'],
    [['add', 'intake', 'login fix'], 'bad topic'],
    [['add', 'intake', 'Login\nFix'], 'bad topic'],
    [['add', 'intake', 'A'.repeat(61)], 'bad topic'],
    [['add', 'intake', 'Login Fix', '../x'], 'bad slug'],
    [['set', 'ABC', 'intake'], 'bad id'],
    [['set', 'aabbccddeeff', 'maybe'], 'bad outcome'],
    [['set', 'aabbccddeeff', 'intake', '../x'], 'bad slug'],
  ];
  for (const [args, reason] of cases) {
    test(`${args.slice(0, 3).join(' ').replace(/\n/g, ' ').slice(0, 30)} -> ${reason}`, () => {
      const r = run(args);
      assert.equal(r.code, 2);
      assert.equal(r.out, `refused: ${reason}\n`);
      assert.ok(!fs.existsSync(dir()), 'nothing written');
    });
  }

  test('no refusal echoes the Topic', () => {
    const topic = 'secret person Name';
    const r = run(['add', 'intake', topic]);
    assert.equal(r.code, 2);
    assert.ok(!r.out.includes('secret'));
    const r2 = run(['add', 'nope', 'Secret Topic']);
    assert.ok(!r2.out.includes('Secret'));
    seed([rec({ topic: 'Secret Topic' }), rec({ topic: 'Secret Topic', id: '111111111111', at: 'x' })]);
    const r3 = run(['set', '999999999999', 'intake']);
    assert.ok(!r3.out.includes('Secret'));
    const l = listIntake(root, { now: NOW });
    assert.ok(!l.warnings.join(' ').includes('Secret'));
  });

  test('a linked intake folder is refused', t => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-target-'));
    t.after(() => fs.rmSync(target, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '.company'));
    try { fs.symlinkSync(target, dir(), 'junction'); } catch { t.skip('cannot make a link here'); return; }
    const r = run(['add', 'intake', 'Login Fix']);
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: intake folder is a link\n');
    assert.deepEqual(fs.readdirSync(target), []);
  });

  test('a linked .company folder is refused', t => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-target-'));
    t.after(() => fs.rmSync(target, { recursive: true, force: true }));
    try { fs.symlinkSync(target, path.join(root, '.company'), 'junction'); } catch { t.skip('cannot make a link here'); return; }
    const r = run(['add', 'intake', 'Login Fix']);
    assert.equal(r.out, 'refused: intake folder is a link\n');
    assert.deepEqual(fs.readdirSync(target), []);
  });

  test('a file with two hard links is unreadable', () => {
    seed([rec()]);
    fs.linkSync(file(), path.join(root, 'other'));
    assert.deepEqual(listIntake(root, { now: NOW }), { v: 1, items: [], warnings: ['intake unreadable'] });
    const r = run(['add', 'intake', 'Login Fix']);
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: intake file unreadable\n');
  });

  test('a file over 64 KiB is unreadable', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(), 'x'.repeat(64 * 1024 + 1));
    assert.deepEqual(listIntake(root, { now: NOW }).warnings, ['intake unreadable']);
    assert.equal(run(['add', 'intake', 'Login Fix']).out, 'refused: intake file unreadable\n');
  });

  test('a directory in place of the file is unreadable', () => {
    fs.mkdirSync(file(), { recursive: true });
    assert.equal(run(['add', 'intake', 'Login Fix']).out, 'refused: intake file unreadable\n');
  });

  test('a .gitignore that is a directory is unreadable', () => {
    fs.mkdirSync(path.join(dir(), '.gitignore'), { recursive: true });
    assert.equal(run(['add', 'intake', 'Login Fix']).out, 'refused: intake file unreadable\n');
  });

  test('over 64 KiB after the write is full', () => {
    const cap = 64 * 1024;
    const line = (i, n) => rec({ id: i.toString(16).padStart(12, '0'), topic: 'A' + 'a'.repeat(n - 1) });
    const len = n => Buffer.byteLength(line(0, n)) + 1;
    const newLen = Buffer.byteLength(JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'intake', topic: 'Login Fix' })) + 1;
    const lines = [];
    let room = cap;
    let i = 0;
    while (room >= len(1)) {
      const n = room < len(60) ? 1 + room - len(1) : 60;
      lines.push(line(i++, n));
      room -= len(n);
    }
    seed(lines);
    const total = fs.statSync(file()).size;
    assert.ok(total <= cap && total + newLen > cap, `size ${total} new ${newLen}`);
    assert.equal(run(['add', 'intake', 'Login Fix']).out, 'refused: intake full\n');
  });
});

describe('hostile lines', () => {
  const bad = [
    'not json',
    '[]',
    rec({ extra: 1 }).replace('}', ',"extra":1}'),
    JSON.stringify({ v: 2, at: iso(NOW), id: 'aabbccddeeff', outcome: 'intake', topic: 'Login Fix' }),
    JSON.stringify({ v: 1, at: '2026-11-04', id: 'aabbccddeeff', outcome: 'intake', topic: 'Login Fix' }),
    JSON.stringify({ v: 1, at: iso(NOW), id: 'AABBCCDDEEFF', outcome: 'intake', topic: 'Login Fix' }),
    JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'done', topic: 'Login Fix' }),
    JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'intake', topic: 'login\u0000' }),
    JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'intake', topic: 'Login Fix', slug: '../x' }),
    JSON.stringify({ v: 1, at: iso(NOW), id: 'aabbccddeeff', outcome: 'intake', topic: 'Login Fix', pad: 'x'.repeat(300) }),
    '__proto__',
  ];

  test('bad lines are skipped with a numbered warning, good ones kept', () => {
    seed([...bad.slice(0, 2), rec(), ...bad.slice(2)]);
    const l = listIntake(root, { now: NOW });
    assert.equal(l.items.length, 1);
    assert.deepEqual(l.warnings, [1, 2, ...bad.slice(2).map((_, i) => i + 4)].map(n => `line ${n} skipped`));
  });

  test('a CR byte skips the line', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(), `${rec()}\r\n${rec({ id: '111111111111' })}\n`);
    const l = listIntake(root, { now: NOW });
    assert.equal(l.items.length, 1);
    assert.deepEqual(l.warnings, ['line 1 skipped']);
  });

  test('a poisoned __proto__ key is refused as unknown', () => {
    seed(['{"__proto__":{"x":1},"v":1,"at":"2026-11-04T12:00:00Z","id":"aabbccddeeff","outcome":"intake","topic":"Login Fix"}']);
    assert.equal(listIntake(root, { now: NOW }).items.length, 0);
  });

  test('bad lines are dropped on the next write', () => {
    seed(['garbage', rec()]);
    run(['add', 'intake', 'Login Fix']);
    assert.equal(fs.readFileSync(file(), 'utf8').trim().split('\n').length, 2);
  });

  test('a stored topic or slug never reaches an output other than list', () => {
    seed([rec({ topic: 'Login Fix' })]);
    const r = run(['set', 'aabbccddeeff', 'maybe']);
    assert.ok(!r.out.includes('Login'));
  });
});

describe('cli', () => {
  test('runs as a script and refuses with exit 2', () => {
    const script = path.join(import.meta.dirname, 'intake.mjs');
    const ok = spawnSync(process.execPath, [script, 'list', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.deepEqual(JSON.parse(ok.stdout).items, []);
    const bad = spawnSync(process.execPath, [script, 'add', 'nope', 'Login Fix'], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, 'refused: bad outcome\n');
  });

  test('unknown command and extra arguments exit 2 with usage', () => {
    assert.equal(run(['frob']).code, 2);
    assert.equal(run(['list']).code, 2);
    assert.equal(run(['add', 'intake', 'Login Fix', '2026-11-04 12.00 - Login Fix', 'more']).code, 2);
  });

  test('ids are random, 12 hex', () => {
    const a = idOf(run(['add', 'intake', 'Login Fix']).out);
    const b = idOf(run(['add', 'intake', 'Login Fix']).out);
    assert.notEqual(a, b);
  });
});
