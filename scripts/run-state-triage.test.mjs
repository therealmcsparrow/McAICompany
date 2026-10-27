import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, show, active, TRIAGE_TTL_MS } from './run-state.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-triage-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const LINE = '(triage: XS, risk low, bug, route direct)';
const REQ = `fix the typo in the readme ${LINE}`;
const NOW = Date.parse('2026-10-27T10:00:00Z');
let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company'), { recursive: true });
  return root;
}
const tdir = root => path.join(root, '.company', 'triage');
const reqFile = root => path.join(tdir(root), 'request.txt');
const recFile = root => path.join(tdir(root), 'records.jsonl');
function put(root, text) {
  fs.mkdirSync(tdir(root), { recursive: true });
  fs.writeFileSync(reqFile(root), text);
}
const call = (root, args, now = NOW) => run(['triage', ...args], { root, now });
function issue(root, text = REQ, now = NOW) {
  put(root, text);
  const r = call(root, ['issue'], now);
  assert.equal(r.code, 0, r.out);
  return JSON.parse(r.out);
}
function check(root, nonce, text = REQ, now = NOW) {
  put(root, text);
  const r = call(root, ['check', nonce], now);
  assert.equal(r.code, 0, r.out);
  return JSON.parse(r.out);
}
const records = root => fs.readFileSync(recFile(root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('issue then check is trusted once, then used', () => {
  const root = repo();
  const { nonce, type } = issue(root);
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.equal(type, 'bug');
  assert.deepEqual(check(root, nonce), { trusted: true, type: 'bug' });
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
});

test('30 minutes is still live, 30 minutes and 1 second is expired', () => {
  const root = repo();
  const a = issue(root);
  assert.equal(check(root, a.nonce, REQ, NOW + TRIAGE_TTL_MS).trusted, true);
  const b = issue(root, REQ, NOW);
  assert.deepEqual(check(root, b.nonce, REQ, NOW + TRIAGE_TTL_MS + 1000), { trusted: false, reason: 'expired' });
});

test('a changed request gives request changed, and the record stays usable', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `other text ${LINE}`), { trusted: false, reason: 'request changed' });
  assert.equal(check(root, nonce).trusted, true);
});

test('a route other than direct is refused at issue and has no triage line at check', () => {
  const root = repo();
  put(root, 'x (triage: XS, risk low, bug, route feature)');
  const r = call(root, ['issue']);
  assert.deepEqual(r, { out: 'refused: no direct triage line', code: 2 });
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, 'x (triage: XS, risk low, bug, route feature)'), { trusted: false, reason: 'no triage line' });
});

test('look-alike type, risk or tier is not a triage line', () => {
  const root = repo();
  for (const bad of ['x (triage: S, risk low, bug, route direct)', 'x (triage: XS, risk high, bug, route direct)',
    'x (triage: XS, risk low, software, route direct)', 'x (triage: XS, risk low, bug, route direct) tail', 'x(triage: XS, risk low, bug, route direct)']) {
    put(root, bad);
    assert.equal(call(root, ['issue']).out, 'refused: no direct triage line', bad);
  }
});

test('no request and no record', () => {
  const root = repo();
  assert.equal(call(root, ['issue']).out, 'refused: no request');
  const { nonce } = issue(root);
  fs.mkdirSync(tdir(root), { recursive: true });
  assert.deepEqual(JSON.parse(call(root, ['check', nonce]).out), { trusted: false, reason: 'no request' });
  assert.deepEqual(check(root, 'a'.repeat(32)), { trusted: false, reason: 'no record' });
});

test('a bad nonce is refused before any read: request.txt stays', () => {
  const root = repo();
  put(root, REQ);
  for (const bad of ['', 'xyz', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) {
    assert.deepEqual(call(root, ['check', bad]), { out: 'refused: bad nonce', code: 2 });
    assert.ok(fs.existsSync(reqFile(root)));
  }
});

test('wrong arguments print the usage', () => {
  const root = repo();
  for (const args of [[], ['issue', 'x'], ['check'], ['check', 'a'.repeat(32), 'b'], ['other']]) {
    const r = call(root, args);
    assert.equal(r.code, 2);
    assert.match(r.out, /^refused: usage:/);
  }
});

test('request.txt is deleted after every call that read it', () => {
  const root = repo();
  put(root, 'no line here');
  call(root, ['issue']);
  assert.ok(!fs.existsSync(reqFile(root)));
  const { nonce } = issue(root);
  assert.ok(!fs.existsSync(reqFile(root)));
  check(root, nonce);
  assert.ok(!fs.existsSync(reqFile(root)));
  check(root, nonce, 'garbage');
  assert.ok(!fs.existsSync(reqFile(root)));
});

test('.gitignore holds exactly "*" and LF, and is rewritten when it differs', () => {
  const root = repo();
  issue(root);
  const ig = path.join(tdir(root), '.gitignore');
  assert.equal(fs.readFileSync(ig, 'utf8'), '*\n');
  fs.writeFileSync(ig, 'nothing\n');
  issue(root);
  assert.equal(fs.readFileSync(ig, 'utf8'), '*\n');
});

test('links at .company, .company/triage, records.jsonl and request.txt are refused', (t) => {
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'f.txt'), REQ);
  const link = (target, p, type) => { fs.symlinkSync(target, p, type); };
  try { link(outside, path.join(base, 'probe'), 'junction'); } catch { t.skip('links not permitted here'); return; }

  const r1 = path.join(base, 'l1');
  fs.mkdirSync(r1);
  link(outside, path.join(r1, '.company'), 'junction');
  assert.equal(call(r1, ['issue']).out, 'refused: triage folder is a link');

  const r2 = repo();
  link(outside, tdir(r2), 'junction');
  assert.equal(call(r2, ['issue']).out, 'refused: triage folder is a link');
  assert.deepEqual(fs.readdirSync(outside), ['f.txt']);

  const r3 = repo();
  fs.mkdirSync(tdir(r3));
  try { link(path.join(outside, 'f.txt'), recFile(r3), 'file'); } catch { return; }
  put(r3, REQ);
  const out = call(r3, ['issue']);
  assert.equal(out.code, 2);
  assert.equal(fs.readFileSync(path.join(outside, 'f.txt'), 'utf8'), REQ);

  const r4 = repo();
  fs.mkdirSync(tdir(r4));
  try { link(path.join(outside, 'f.txt'), reqFile(r4), 'file'); } catch { return; }
  assert.equal(call(r4, ['issue']).out, 'refused: no request');
  assert.ok(fs.existsSync(path.join(outside, 'f.txt')));
});

test('records.jsonl holds hashes and times only', () => {
  const root = repo();
  const { nonce } = issue(root);
  check(root, nonce);
  const text = fs.readFileSync(recFile(root), 'utf8');
  assert.ok(!text.includes(nonce));
  assert.ok(!text.includes('typo'));
  assert.ok(!text.includes('triage'));
  const recs = records(root);
  assert.deepEqual(recs.map(r => r.ev), ['issue', 'used']);
  assert.deepEqual(Object.keys(recs[0]).sort(), ['at', 'ev', 'h', 'k', 'v']);
  assert.deepEqual(Object.keys(recs[1]).sort(), ['at', 'ev', 'k', 'v']);
  assert.match(recs[0].at, /^2026-10-27T10:00:00Z$/);
});

test('expired lines are pruned, with their used lines', () => {
  const root = repo();
  const a = issue(root);
  check(root, a.nonce);
  const later = NOW + TRIAGE_TTL_MS + 5000;
  const b = issue(root, REQ, later);
  const recs = records(root);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ev, 'issue');
  assert.equal(check(root, b.nonce, REQ, later).trusted, true);
  assert.deepEqual(check(root, a.nonce, REQ, later), { trusted: false, reason: 'no record' });
});

test('bad lines in records.jsonl are dropped, good ones kept', () => {
  const root = repo();
  const a = issue(root);
  fs.appendFileSync(recFile(root), 'not json\n{"v":1,"at":"2026-10-27T10:00:00Z","ev":"issue","k":"zz"}\n');
  issue(root);
  assert.equal(records(root).length, 2);
  assert.equal(check(root, a.nonce).trusted, true);
});

test('CRLF and edge whitespace give the same hash', () => {
  const root = repo();
  const { nonce } = issue(root, `line one\r\nline two ${LINE}`);
  assert.equal(check(root, nonce, `\n  \tline one\nline two ${LINE} \r\n\t`).trusted, true);
});

test('a full record file refuses issue', () => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  const rec = JSON.stringify({ v: 1, at: '2026-10-27T10:00:00Z', ev: 'issue', h: 'c'.repeat(64), k: 'b'.repeat(64) }) + '\n';
  fs.writeFileSync(recFile(root), rec.repeat(Math.floor((64 * 1024) / rec.length)));
  put(root, REQ);
  assert.equal(call(root, ['issue']).out, 'refused: triage record full');
  assert.ok(!fs.existsSync(reqFile(root)));
});

test('an oversize records.jsonl is refused and request.txt is still deleted', () => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  fs.writeFileSync(recFile(root), 'x'.repeat(70 * 1024));
  put(root, REQ);
  assert.equal(call(root, ['issue']).out, 'refused: triage record unreadable');
  assert.ok(!fs.existsSync(reqFile(root)));
});

test('a request that is not UTF-8 or over 64 KiB counts as no request', () => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  fs.writeFileSync(reqFile(root), Buffer.from([0xff, 0xfe, 0x20]));
  assert.equal(call(root, ['issue']).out, 'refused: no request');
  fs.writeFileSync(reqFile(root), `${'a'.repeat(70 * 1024)} ${LINE}`);
  assert.equal(call(root, ['issue']).out, 'refused: no request');
  assert.ok(!fs.existsSync(reqFile(root)));
});

test('show and active are unchanged by the triage folder', () => {
  const root = repo();
  issue(root);
  assert.deepEqual(active(root, { now: NOW }), { slug: null, view: null });
  assert.equal(show(root, 'x', { now: NOW }).state, 'none');
  const r = run(['start', 'x'], { root, now: NOW });
  assert.equal(r.code, 0);
  assert.equal(active(root, { now: NOW }).slug, 'x');
});

// Shapes of requests the main session rewrites when it writes them to request.txt.
const SHAPES = {
  trailingSpaces: ['trailing spaces here   \nand a tab\t\nlast line   ', 'trailing spaces here\nand a tab\nlast line'],
  crlf: ['CRLF line one\r\nCRLF line two\r\n\r\nline four\r\n', 'CRLF line one\nCRLF line two\n\nline four'],
  mixedEndings: ['mixed\r\nendings\nhere\r\nand lone cr\rend\n', 'mixed\nendings\nhere\nand lone cr\nend'],
  leadingBlank: ['\n\n  leading blank lines and indent\n    nested  \n\n\n', '  leading blank lines and indent\n    nested'],
  special: ['Special: <tag> & "dq" \'sq\' `bt` $HOME %PATH% \n literal \ backslash {{x}} ${y}\n---\n# heading\n* a\n', 'Special: <tag> & "dq" \'sq\' `bt` $HOME %PATH%\n literal \ backslash {{x}} ${y}\n---\n# heading\n* a'],
  decomposed: ['caf\u0065\u0301 au lait', 'caf\u00e9 au lait'],
};
for (const [name, [raw, rewritten]] of Object.entries(SHAPES)) {
  test(`normalization: ${name} hashes the same before and after the rewrite`, () => {
    const root = repo();
    const { nonce } = issue(root, `${raw.trimEnd()} ${LINE}`);
    assert.equal(check(root, nonce, `${rewritten.trimEnd()} ${LINE}`).trusted, true);
  });
}

test('normalization does not hide a real change', () => {
  const root = repo();
  const { nonce } = issue(root, `a b ${LINE}`);
  assert.deepEqual(check(root, nonce, `a  b ${LINE}`), { trusted: false, reason: 'request changed' });
});
