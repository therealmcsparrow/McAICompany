import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// R-22 (Step 52): lead-turn.json that exists but is not a readable regular file (symlink, directory, multi-link, over 64 KiB)
// must make typeInto refuse to type (fail closed). A missing file still means no mark. The unsafe file always holds (or points at)
// a mark newer than the accepted Stop reading, so a reader that sees through the file kind would refuse too; only fail-closed on the kind passes
// for the right reason. Red today: readMark treats an unreadable file as no mark.

const here = path.dirname(fileURLToPath(import.meta.url));
const load = () => import(pathToFileURL(path.join(here, 'lead-replace.mjs')).href);
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const FROZEN = 'abcdef012345';
const NEW = '0123456789ab';
const PROMPT = 'aico lead hand-over: run lead-handover read first.';
const NEWER = `${JSON.stringify({ v: 1, session: FROZEN, at: '2026-11-15T10:00:05.000Z' })}\n`;
const OLDER = `${JSON.stringify({ v: 1, session: FROZEN, at: '2026-11-15T09:59:00.000Z' })}\n`;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-kind-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  const reading = (session, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'),
    `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 170000, at: iso(atMs), ttl: null })}\n`);
  reading(FROZEN, T0);
  const c = { t: T0 };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.t += ms; };
  const r = { calls: [] };
  r.run = async (argv, input) => {
    const text = input.toString('utf8');
    r.calls.push(text);
    if (text.startsWith('/clear')) reading(NEW, c.t + 500);
    return { status: 0 };
  };
  const opts = { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: 4242, now: c.now, sleep: c.sleep, accepted: { session: FROZEN, at: iso(T0) } };
  return { dir, file: path.join(dir, 'lead-turn.json'), r, opts };
}

async function expectRefused(s) {
  const { typeInto } = await load();
  const out = await typeInto(PROMPT, s.opts);
  assert.deepEqual(s.r.calls, [], 'nothing may be typed while lead-turn.json is not a readable regular file');
  assert.match(out, /^failed: /);
}

describe('R-22: lead-turn.json that is not a readable regular file', () => {
  test('control: file missing -> no mark -> typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    assert.equal(await typeInto(PROMPT, s.opts), 'typed');
    assert.deepEqual(s.r.calls, ['/clear\r', `${PROMPT}\r`]);
  });

  test('control: regular file with an older mark -> typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    fs.writeFileSync(s.file, OLDER);
    assert.equal(await typeInto(PROMPT, s.opts), 'typed');
  });

  test('directory named lead-turn.json -> nothing typed', async () => {
    const s = setup();
    fs.mkdirSync(s.file);
    await expectRefused(s);
  });

  test('symlink to a file -> nothing typed', async (t) => {
    const s = setup();
    const target = path.join(s.dir, 'elsewhere.json');
    fs.writeFileSync(target, NEWER);
    try { fs.symlinkSync(target, s.file, 'file'); } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') { t.skip(`OS cannot create a symlink here (${e.code})`); return; }
      throw e;
    }
    await expectRefused(s);
  });

  test('dangling symlink -> nothing typed', async (t) => {
    const s = setup();
    try { fs.symlinkSync(path.join(s.dir, 'does-not-exist.json'), s.file, 'file'); } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') { t.skip(`OS cannot create a symlink here (${e.code})`); return; }
      throw e;
    }
    await expectRefused(s);
  });

  test('file with two hard links -> nothing typed', async () => {
    const s = setup();
    const other = path.join(s.dir, 'second-link.json');
    fs.writeFileSync(other, NEWER);
    fs.linkSync(other, s.file);
    assert.equal(fs.statSync(s.file).nlink, 2);
    await expectRefused(s);
  });

  test('file over 64 KiB -> nothing typed', async () => {
    const s = setup();
    fs.writeFileSync(s.file, `${JSON.stringify({ v: 1, session: FROZEN, at: '2026-11-15T10:00:05.000Z', pad: 'x'.repeat(70 * 1024) })}\n`);
    assert.ok(fs.statSync(s.file).size > 64 * 1024);
    await expectRefused(s);
  });
});
