import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, show, active, verifyOpened, TRIAGE_TTL_MS } from './run-state.mjs';

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

test('a changed request gives request changed, and the record is spent', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `other text ${LINE}`), { trusted: false, reason: 'request changed' });
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
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
  try { link(path.join(outside, 'f.txt'), recFile(r3), 'file'); } catch { t.skip('file links not permitted here'); return; }
  put(r3, REQ);
  const out = call(r3, ['issue']);
  assert.equal(out.code, 2);
  assert.equal(fs.readFileSync(path.join(outside, 'f.txt'), 'utf8'), REQ);

  const r4 = repo();
  fs.mkdirSync(tdir(r4));
  try { link(path.join(outside, 'f.txt'), reqFile(r4), 'file'); } catch { t.skip('file links not permitted here'); return; }
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

// Each pair is one request before and after the normalization steps: NFC, line endings, per-line trailing blanks, edge trim.
const BS = String.fromCharCode(92);
const SHAPES = {
  nfc: [`El ni\u006e\u0303o y \u0041\u030angstrom ${LINE}`, `El ni\u00f1o y \u00c5ngstrom ${LINE}`],
  crlf: [`alpha\r\nbeta\r\n\r\ngamma ${LINE}`, `alpha\nbeta\n\ngamma ${LINE}`],
  loneCr: [`one\rtwo\rthree ${LINE}`, `one\ntwo\nthree ${LINE}`],
  lineTrailing: [`first \t \nsecond\t\n\nthird  \nfourth ${LINE}`, `first\nsecond\n\nthird\nfourth ${LINE}`],
  edges: [`\n\t \n  open with blanks ${LINE} \t\r\n\n`, `open with blanks ${LINE}`],
  backslash: [`copy C:${BS}temp${BS}new 
end with a slash${BS} 
regex ${BS}d+${BS}s ${LINE}`, `copy C:${BS}temp${BS}new
end with a slash${BS}
regex ${BS}d+${BS}s ${LINE}`],
};
for (const [name, [raw, same]] of Object.entries(SHAPES)) {
  test(`normalization: ${name} hashes the same before and after`, () => {
    const root = repo();
    const { nonce } = issue(root, raw);
    assert.equal(check(root, nonce, same).trusted, true);
  });
}

test('a backslash is kept: removing it is a real change', () => {
  const root = repo();
  const { nonce } = issue(root, `open C:${BS}temp ${LINE}`);
  assert.deepEqual(check(root, nonce, `open C:temp ${LINE}`), { trusted: false, reason: 'request changed' });
});

test('normalization does not hide a real change', () => {
  const root = repo();
  const { nonce } = issue(root, `a b ${LINE}`);
  assert.deepEqual(check(root, nonce, `a  b ${LINE}`), { trusted: false, reason: 'request changed' });
});

// Whitespace edges, record independence and expiry.
test('trailing whitespace right before the triage line, on its own line, is stripped from both sides', () => {
  const root = repo();
  const { nonce } = issue(root, `fix the typo   \t\n ${LINE}`);
  assert.equal(check(root, nonce, `fix the typo\n ${LINE}`).trusted, true);
  assert.equal(check(root, nonce, `fix the typo\n ${LINE}`).reason, 'used');
});

test('trailing whitespace after the triage line and on the line before it hash the same', () => {
  const root = repo();
  const { nonce } = issue(root, `first line  \r\nsecond line ${LINE}  \t\r\n`);
  assert.equal(check(root, nonce, `first line\nsecond line ${LINE}`).trusted, true);
});

test('spaces between the request and the triage line on the same line stay significant', () => {
  const root = repo();
  const a = issue(root, `fix it  ${LINE}`);
  assert.deepEqual(check(root, a.nonce, `fix it ${LINE}`), { trusted: false, reason: 'request changed' });
  const b = issue(root, `fix it  ${LINE}`);
  assert.equal(check(root, b.nonce, `fix it  ${LINE}`).trusted, true);
});

test('the triage line needs a space before it: a line glued to the text or alone is not a triage line', () => {
  const root = repo();
  for (const bad of [`fix it\n${LINE}`, LINE, `fix it\t${LINE}`]) {
    put(root, bad);
    assert.equal(call(root, ['issue']).out, 'refused: no direct triage line', JSON.stringify(bad));
  }
});

test('a refused issue writes no record and a failed check spends the nonce', () => {
  const root = repo();
  put(root, 'x (triage: XS, risk low, bug, route feature)');
  call(root, ['issue']);
  assert.ok(!fs.existsSync(recFile(root)) || records(root).length === 0);
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `changed ${LINE}`), { trusted: false, reason: 'request changed' });
  assert.deepEqual(records(root).map(r => r.ev), ['issue', 'used']);
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
});

test('a check that finds a live record spends it whatever the result', () => {
  for (const [text, reason] of [['garbage', 'no triage line'], [`other ${LINE}`, 'request changed']]) {
    const root = repo();
    const { nonce } = issue(root);
    assert.deepEqual(check(root, nonce, text), { trusted: false, reason });
    assert.deepEqual(records(root).map(r => r.ev), ['issue', 'used']);
    assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
  }
  const root = repo();
  const { nonce } = issue(root);
  assert.equal(call(root, ['check', nonce]).out, JSON.stringify({ trusted: false, reason: 'no request' }));
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
});

test('a check that finds no live record appends nothing', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, 'b'.repeat(32)), { trusted: false, reason: 'no record' });
  assert.deepEqual(check(root, nonce, REQ, NOW + TRIAGE_TTL_MS + 1000), { trusted: false, reason: 'expired' });
  assert.ok(!fs.existsSync(recFile(root)) || records(root).every(r => r.ev !== 'used'));
});

test('a copied line on another request fails, and a replay after use fails', () => {
  const root = repo();
  const { nonce } = issue(root, `request A ${LINE}`);
  assert.deepEqual(check(root, nonce, `request B ${LINE}`), { trusted: false, reason: 'request changed' });
  assert.deepEqual(check(root, nonce, `request A ${LINE}`), { trusted: false, reason: 'used' });
});

test('a nonce for one record does not unlock another: two live records stay independent', () => {
  const root = repo();
  const a = issue(root, `A ${LINE}`);
  const b = issue(root, `B ${LINE}`);
  assert.deepEqual(check(root, a.nonce, `B ${LINE}`), { trusted: false, reason: 'request changed' });
  assert.equal(check(root, b.nonce, `B ${LINE}`).trusted, true);
  assert.deepEqual(check(root, a.nonce, `A ${LINE}`), { trusted: false, reason: 'used' });
});

test('a used record that has also expired reports used (documented residual)', () => {
  const root = repo();
  const { nonce } = issue(root);
  check(root, nonce);
  assert.equal(check(root, nonce, REQ, NOW + 60 * 1000).reason, 'used');
});

test('a record with a time in the future is expired', () => {
  const root = repo();
  const { nonce } = issue(root, REQ, NOW + 3600 * 1000);
  assert.deepEqual(check(root, nonce, REQ, NOW), { trusted: false, reason: 'expired' });
});

test('a record line with an unknown key is dropped, so its nonce has no record', () => {
  const root = repo();
  const { nonce } = issue(root);
  const [rec] = records(root);
  fs.writeFileSync(recFile(root), JSON.stringify({ ...rec, extra: 'x' }) + '\n');
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'no record' });
});

test('a rewritten record that points an old key at another request is refused', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.equal(check(root, nonce).trusted, true);
  const forged = `delete everything ${LINE}`;
  const [rec] = records(root);
  const plain = crypto.createHash('sha256').update(forged).digest('hex');
  fs.writeFileSync(recFile(root), JSON.stringify({ ...rec, h: plain, at: '2026-10-27T10:00:00Z' }) + '\n');
  assert.deepEqual(check(root, nonce, forged, NOW), { trusted: false, reason: 'request changed' });
});

test('the stored hash is not the plain hash of the request', () => {
  const root = repo();
  issue(root);
  const plain = crypto.createHash('sha256').update(REQ).digest('hex');
  assert.notEqual(records(root)[0].h, plain);
});

test('records dated in the future are pruned', () => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  const future = JSON.stringify({ v: 1, at: '2099-01-01T00:00:00Z', ev: 'issue', h: 'c'.repeat(64), k: 'b'.repeat(64) }) + '\n';
  fs.writeFileSync(recFile(root), future.repeat(50));
  issue(root);
  assert.equal(records(root).length, 1);
});

test('a check with an unknown nonce is no record and leaves the real nonce usable', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, 'b'.repeat(32)), { trusted: false, reason: 'no record' });
  assert.equal(check(root, nonce).trusted, true);
});

// Enclosing quotes (the CEO's /aico:lead "<request> (triage: ...)" fallback).
test('one pair of enclosing quotes is dropped at check', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `"${REQ}"`), { trusted: true, type: 'bug' });
});

test('enclosing quotes with surrounding spaces and CRLF are dropped', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `  "${REQ}"  \r\n`), { trusted: true, type: 'bug' });
});

test('a request that starts with a quote of its own, wrapped once more, is trusted', () => {
  const root = repo();
  const own = `"fix it" now ${LINE}`;
  const { nonce } = issue(root, own);
  assert.deepEqual(check(root, nonce, `"${own}"`), { trusted: true, type: 'bug' });
});

test('two pairs of quotes are not dropped twice: no triage line', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `""${REQ}""`), { trusted: false, reason: 'no triage line' });
});

test('a leading quote only is a changed request', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(check(root, nonce, `"${REQ}`), { trusted: false, reason: 'request changed' });
});

test('the stored h is the HMAC of the normalized request under the printed nonce', () => {
  const root = repo();
  const { nonce } = issue(root, `  ${REQ}  \r\n`);
  const want = crypto.createHmac('sha256', nonce).update(REQ).digest('hex');
  assert.equal(records(root)[0].h, want);
  assert.equal(records(root)[0].k, crypto.createHash('sha256').update(nonce).digest('hex'));
});

// Hard links: a file with more than one link is not a plain file.
function hardlink(t, from, to) {
  try { fs.linkSync(from, to); return true; } catch { t.skip('hard links not permitted here'); return false; }
}

test('a hard-linked .gitignore is refused and left alone', (t) => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  const outside = path.join(base, 'hl-ig.txt');
  fs.writeFileSync(outside, 'keep\n');
  if (!hardlink(t, outside, path.join(tdir(root), '.gitignore'))) return;
  put(root, REQ);
  assert.equal(call(root, ['issue'], Date.now()).out, 'refused: triage folder is a link');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n');
  assert.equal(fs.existsSync(reqFile(root)), false);
});

test('a hard-linked records.jsonl is refused and left alone', (t) => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  const outside = path.join(base, 'hl-rec.txt');
  fs.writeFileSync(outside, 'keep\n');
  if (!hardlink(t, outside, recFile(root))) return;
  put(root, REQ);
  assert.equal(call(root, ['issue']).out, 'refused: triage record unreadable');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n');
  assert.equal(fs.existsSync(reqFile(root)), false);
});

test('a hard-linked request.txt counts as missing and its name is deleted', (t) => {
  const root = repo();
  fs.mkdirSync(tdir(root), { recursive: true });
  const outside = path.join(base, 'hl-req.txt');
  fs.writeFileSync(outside, REQ);
  if (!hardlink(t, outside, reqFile(root))) return;
  assert.equal(call(root, ['issue']).out, 'refused: no request');
  assert.equal(fs.existsSync(reqFile(root)), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), REQ);
});

// Refusal through a linked folder: request.txt is unlinked by name only when it is a single-link regular file written in the last 10 minutes.
function linkedTriage(t, name) {
  const outside = path.join(base, name);
  fs.mkdirSync(outside, { recursive: true });
  const root = repo();
  try { fs.symlinkSync(outside, tdir(root), 'junction'); } catch { t.skip('links not permitted here'); return null; }
  return { root, outside };
}
const issueNow = root => run(['triage', 'issue'], { root, now: Date.now() }).out;

test('a link at the triage folder is refused and a fresh request.txt behind it is deleted', (t) => {
  const l = linkedTriage(t, 'outside-del');
  if (!l) return;
  fs.writeFileSync(path.join(l.outside, 'request.txt'), REQ);
  fs.writeFileSync(path.join(l.outside, 'other.txt'), 'keep');
  assert.equal(issueNow(l.root), 'refused: triage folder is a link');
  assert.deepEqual(fs.readdirSync(l.outside), ['other.txt']);
});

test('a link at the triage folder is refused and an old request.txt behind it is left', (t) => {
  const l = linkedTriage(t, 'outside-old');
  if (!l) return;
  const f = path.join(l.outside, 'request.txt');
  fs.writeFileSync(f, 'mine');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(f, old, old);
  assert.equal(issueNow(l.root), 'refused: triage folder is a link');
  assert.equal(fs.readFileSync(f, 'utf8'), 'mine');
});

test('a request.txt with a second hard link behind a link is left', (t) => {
  const l = linkedTriage(t, 'outside-hl');
  if (!l) return;
  const f = path.join(l.outside, 'request.txt');
  fs.writeFileSync(path.join(base, 'hl-keep.txt'), 'mine');
  if (!hardlink(t, path.join(base, 'hl-keep.txt'), f)) return;
  assert.equal(issueNow(l.root), 'refused: triage folder is a link');
  assert.equal(fs.readFileSync(f, 'utf8'), 'mine');
});

// The opened handle is checked again: regular file, one link, same dev and ino as the lstat.
test('verifyOpened accepts the same plain file and refuses another file or a second link', (t) => {
  const a = path.join(base, 'vo-a.txt');
  const b = path.join(base, 'vo-b.txt');
  fs.writeFileSync(a, 'a');
  fs.writeFileSync(b, 'b');
  const fda = fs.openSync(a, 'r');
  try {
    assert.equal(verifyOpened(fda, fs.lstatSync(a)), true);
    assert.equal(verifyOpened(fda, fs.lstatSync(b)), false);
    assert.equal(verifyOpened(fda, null), true);
    if (hardlink(t, a, path.join(base, 'vo-c.txt'))) assert.equal(verifyOpened(fda, null), false);
  } finally { fs.closeSync(fda); }
});

// Fix route (v1.4): the fix line is recorded by issue and checked only with --route fix.
const FIX = '(triage: S, risk low, bug, route fix)';
const FIXREQ = `the login button does nothing ${FIX}`;
const checkFix = (root, nonce, text = FIXREQ, now = NOW) => {
  put(root, text);
  const r = call(root, ['check', nonce, '--route', 'fix'], now);
  assert.equal(r.code, 0, r.out);
  return JSON.parse(r.out);
};

test('hostile fix lines are not recordable', () => {
  const bad = [
    `x ${FIX} more`, `x(triage: S, risk low, bug, route fix)`,
    'x (triage: S, risk medium, bug, route fix)', 'x (triage: S, risk high, bug, route fix)', 'x (triage: L, risk low, bug, route fix)',
    'x (triage: XL, risk low, bug, route fix)', 'x (triage: s, risk low, bug, route fix)', 'x (triage: S, risk low, bug, route Fix)',
    'x (triage: S, risk low, feature, route fix)', 'x (triage: S, risk low, bug, route fix)\u0430',
    'x (triage: S, risk low, bug, route f\u0456x)', 'x (triage: S, risk low, bug, route fix)\nmore',
    `${FIX} then text`, 'x (triage: S, risk low, bug, route direct)',
  ];
  for (const text of bad) {
    const root = repo();
    put(root, text);
    const r = call(root, ['issue']);
    assert.equal(r.code, 2, JSON.stringify(text));
    assert.match(r.out, /^refused: no direct triage line$/, JSON.stringify(text));
    assert.equal(fs.existsSync(recFile(root)), false);
  }
});

test('issue accepts a fix line at XS, S and M, then check --route fix trusts it once', () => {
  for (const size of ['XS', 'S', 'M']) {
    const root = repo();
    const text = `crash on save (triage: ${size}, risk low, bug, route fix)`;
    const { nonce, type } = issue(root, text);
    assert.equal(type, 'bug');
    assert.deepEqual(checkFix(root, nonce, text), { trusted: true, type: 'bug' });
    assert.deepEqual(checkFix(root, nonce, text), { trusted: false, reason: 'used' });
  }
});

test('check without --route refuses a fix line and spends the record', () => {
  const root = repo();
  const { nonce } = issue(root, FIXREQ);
  assert.deepEqual(check(root, nonce, FIXREQ), { trusted: false, reason: 'no triage line' });
  assert.deepEqual(checkFix(root, nonce), { trusted: false, reason: 'used' });
});

test('check --route fix refuses a direct line and spends the record', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(checkFix(root, nonce, REQ), { trusted: false, reason: 'no triage line' });
  assert.deepEqual(check(root, nonce), { trusted: false, reason: 'used' });
});

test('a direct record cannot be replayed as a fix line on another request', () => {
  const root = repo();
  const { nonce } = issue(root);
  assert.deepEqual(checkFix(root, nonce, FIXREQ), { trusted: false, reason: 'request changed' });
});

test('a fix line mid-text or on an unrecorded request has no trust', () => {
  const root = repo();
  const { nonce } = issue(root, FIXREQ);
  assert.deepEqual(checkFix(root, nonce, `${FIX} and more words`), { trusted: false, reason: 'no triage line' });
  assert.deepEqual(checkFix(root, 'c'.repeat(32), FIXREQ), { trusted: false, reason: 'no record' });
});

test('trailing space or CR after a fix line follows the same normalization as the direct line', () => {
  const root = repo();
  const { nonce } = issue(root, `${FIXREQ}  \r\n`);
  assert.deepEqual(checkFix(root, nonce, FIXREQ), { trusted: true, type: 'bug' });
});

test('--route takes only fix, once, after the nonce', () => {
  const root = repo();
  for (const args of [['check', 'a'.repeat(32), '--route'], ['check', 'a'.repeat(32), '--route', 'direct'], ['check', 'a'.repeat(32), '--route', 'FIX'],
    ['check', 'a'.repeat(32), '--route=fix'], ['check', 'a'.repeat(32), 'fix'], ['check', 'a'.repeat(32), '--route', 'fix', 'x'],
    ['check', '--route', 'fix', 'a'.repeat(32)], ['issue', '--route', 'fix']]) {
    put(root, FIXREQ);
    const r = call(root, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.out, /^refused: /);
    assert.ok(fs.existsSync(reqFile(root)), `${args.join(' ')} reads nothing`);
  }
});

test('the record of a fix line holds hashes and times only', () => {
  const root = repo();
  issue(root, FIXREQ);
  const raw = fs.readFileSync(recFile(root), 'utf8');
  assert.equal(raw.includes('login'), false);
  assert.equal(raw.includes('fix'), false);
  assert.deepEqual(Object.keys(records(root)[0]).sort(), ['at', 'ev', 'h', 'k', 'v']);
});
