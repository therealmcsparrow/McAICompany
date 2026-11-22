// Pin hash input: CRLF read as LF, NUL-containing files hashed raw, lone CR kept, real change still flips.
// Covers scripts/hook-host.mjs (pinHashes, checkPins), scripts/hook-check.mjs (check, denies path), hooks/lib/dep-pins.mjs (depHashes, verifyDeps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pinHashes, checkPins } from './hook-host.mjs';
import { check } from './hook-check.mjs';
import { depHashes, verifyDeps } from '../hooks/lib/dep-pins.mjs';

const made = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-bytes-'));
  made.push(d);
  return d;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const rawSha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const put = (root, rel, content) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

const HOST = 'scripts/hook-host.mjs';
const LF = 'export const a = 1;\nexport const b = 2;\n';
const CRLF = LF.replace(/\n/g, '\r\n');
const NUL_LF = Buffer.from('x\0\ny\n');
const NUL_CRLF = Buffer.from('x\0\r\ny\r\n');

// ---- hook-host: pinHashes / checkPins ----------------------------------------------------------------

test('hook-host pinHashes: CRLF and LF copies of one file hash the same', () => {
  const a = tmp(); const b = tmp();
  put(a, HOST, LF); put(b, HOST, CRLF);
  put(a, 'hooks/lib/x.mjs', LF); put(b, 'hooks/lib/x.mjs', CRLF);
  assert.deepEqual(pinHashes(a), pinHashes(b));
  assert.equal(pinHashes(a).files[HOST], rawSha(LF));
});

test('hook-host checkPins: pins written on an LF tree pass on a CRLF copy and the reverse', () => {
  const lf = tmp(); const crlf = tmp();
  put(lf, HOST, LF); put(crlf, HOST, CRLF);
  put(lf, 'hooks/pins.json', JSON.stringify(pinHashes(crlf)));
  assert.deepEqual(checkPins(lf), { ok: true });
  put(crlf, 'hooks/pins.json', JSON.stringify(pinHashes(lf)));
  assert.deepEqual(checkPins(crlf), { ok: true });
});

test('hook-host pinHashes: a file with a NUL byte is hashed as the raw bytes, CRLF kept', () => {
  const r = tmp();
  put(r, HOST, NUL_CRLF);
  assert.equal(pinHashes(r).files[HOST], rawSha(NUL_CRLF));
  const s = tmp();
  put(s, HOST, NUL_LF);
  assert.notEqual(pinHashes(s).files[HOST], pinHashes(r).files[HOST], 'changing CRLF to LF in a binary file flips the hash');
});

test('hook-host pinHashes: a lone CR still flips the hash', () => {
  const a = tmp(); const b = tmp(); const c = tmp();
  put(a, HOST, 'a\rb\n'); put(b, HOST, 'a\nb\n'); put(c, HOST, 'ab\n');
  const h = (r) => pinHashes(r).files[HOST];
  assert.notEqual(h(a), h(b));
  assert.notEqual(h(a), h(c));
});

test('hook-host checkPins: a real content change still mismatches, even on a CRLF file', () => {
  const r = tmp();
  put(r, HOST, CRLF);
  put(r, 'hooks/pins.json', JSON.stringify(pinHashes(r)));
  assert.deepEqual(checkPins(r), { ok: true });
  put(r, HOST, CRLF.replace('= 2', '= 3'));
  assert.deepEqual(checkPins(r), { ok: false, files: [HOST] });
});

// ---- hook-check: pins check ------------------------------------------------------------------------

const pinMismatches = (root) => check(root).filter((p) => p.startsWith('pins-mismatch'));

test('hook-check check: pins written from an LF tree give no pins-mismatch on a CRLF copy', () => {
  const lf = tmp(); const crlf = tmp();
  put(lf, HOST, LF); put(crlf, HOST, CRLF);
  put(lf, 'hooks/lib/x.mjs', LF); put(crlf, 'hooks/lib/x.mjs', CRLF);
  put(crlf, 'hooks/pins.json', JSON.stringify(pinHashes(lf).files));
  assert.deepEqual(pinMismatches(crlf), []);
});

test('hook-check check: NUL file raw, lone CR flips, real change mismatches', () => {
  const r = tmp();
  put(r, HOST, LF);
  put(r, 'hooks/lib/bin.mjs', NUL_CRLF);
  put(r, 'hooks/lib/cr.mjs', 'a\rb\n');
  put(r, 'hooks/pins.json', JSON.stringify({ [HOST]: rawSha(LF), 'hooks/lib/bin.mjs': rawSha(NUL_CRLF), 'hooks/lib/cr.mjs': rawSha('a\rb\n') }));
  assert.deepEqual(pinMismatches(r), []);
  put(r, 'hooks/lib/bin.mjs', NUL_LF);
  put(r, 'hooks/lib/cr.mjs', 'a\nb\n');
  put(r, HOST, LF + '// changed\n');
  assert.deepEqual(pinMismatches(r).sort(), ['pins-mismatch: hooks/lib/bin.mjs', 'pins-mismatch: hooks/lib/cr.mjs', `pins-mismatch: ${HOST}`].sort());
});

// ---- dep-pins: depHashes / verifyDeps ----------------------------------------------------------------

const ENTRIES = ['scripts/lead-handover.mjs', 'scripts/run-state.mjs', 'scripts/lead-relay.mjs'];
function depRoot(body) {
  const r = tmp();
  for (const e of ENTRIES) put(r, e, body);
  return r;
}

test('dep-pins depHashes: CRLF and LF give equal hashes, verifyDeps passes across them', () => {
  const lf = depRoot('// entry\nexport const v = 1;\n');
  const crlf = depRoot('// entry\r\nexport const v = 1;\r\n');
  assert.deepEqual(depHashes(lf).hashes, depHashes(crlf).hashes);
  assert.deepEqual(verifyDeps(crlf, depHashes(lf).hashes), []);
});

test('dep-pins depHashes: NUL file raw, lone CR flips, real change mismatches', () => {
  const nulCrlf = depRoot('// \0\r\nexport const v = 1;\r\n');
  const nulLf = depRoot('// \0\nexport const v = 1;\n');
  assert.equal(depHashes(nulCrlf).hashes[ENTRIES[0]], rawSha(Buffer.from('// \0\r\nexport const v = 1;\r\n')));
  assert.notEqual(depHashes(nulCrlf).hashes[ENTRIES[0]], depHashes(nulLf).hashes[ENTRIES[0]]);
  const cr = depRoot('// a\rb\nexport const v = 1;\n');
  const lf = depRoot('// a\nb\nexport const v = 1;\n');
  assert.notEqual(depHashes(cr).hashes[ENTRIES[0]], depHashes(lf).hashes[ENTRIES[0]]);
  const changed = depRoot('// entry\nexport const v = 2;\n');
  const base = depHashes(depRoot('// entry\nexport const v = 1;\n')).hashes;
  assert.deepEqual(verifyDeps(changed, base).sort(), [...ENTRIES].sort());
});

// ---- hook-check denies: the project key is the plain SHA-256 of the root path text ------------------

test('hook-check denies: finds the log under sha256(realpath) for a path with no "0" in it', () => {
  // pinBytes must not be applied to a string: String.includes(0) looks for the character "0", so only
  // root paths containing "0" hashed right. Use a project path without any "0".
  const letters = () => Array.from({ length: 8 }, () => 'abcdefghijklmnop'[Math.floor(Math.random() * 16)]).join('');
  let project = null;
  for (const base of [os.tmpdir(), path.parse(os.tmpdir()).root, os.homedir()]) {
    const p = path.join(base, `qa-pin-${letters()}`);
    try { fs.mkdirSync(path.join(p, '.company'), { recursive: true }); } catch { continue; }
    made.push(p);
    if (!fs.realpathSync(p).includes('0')) { project = p; break; }
  }
  assert.ok(project, 'a writable base path without "0" exists');
  const home = tmp();
  const key = rawSha(fs.realpathSync(project)).slice(0, 12);
  put(home, `hook-snapshots/${key}/denies.jsonl`, JSON.stringify({ v: 1, at: '2026-11-14T10:00:00Z', rule: 'cap.M1', kind: 'deny', session: 's1', agent: null }) + '\n');
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'hook-check.mjs'), 'denies', '--session', 's1', '--json'], {
    cwd: project, encoding: 'utf8', timeout: 30000, env: { ...process.env, MCSPARROW_HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 1);
});
