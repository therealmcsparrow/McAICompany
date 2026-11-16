// Tests for lead-session-mcp v2.1. `lead_new_session` on a v3 run slug `<ID>/<NN>-<playbook>`.
// Nothing real is started: every call goes through the deps.start seam (a spy) with process.platform pinned to win32.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSession, handle } from './lead-launch-mcp.mjs';
import { newSessionCommand } from './lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const SCRIPT = path.join(here, 'lead-launch-mcp.mjs');
const ID = 'P20261109.000001';
const SLUG = `${ID}/01-feature`;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A product root with one run (v3 when the slug has a `/`); `handover` writes a handover event of that trigger.
function fixture({ slug = SLUG, running = false, handover = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-v3-'));
  tmps.push(root);
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  if (slug.includes('/')) fs.writeFileSync(path.join(work, slug.split('/')[0], '00-project.md'), 'Demo project\n');
  const now = Date.now();
  const id = '000000000001';
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }, { v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' }];
  if (!running) rows.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  if (handover) {
    const ev = { v: 1, n: 1, at: iso(now - 1000), ev: 'handover', file: 'lead-handoff-1.md', tokens: 85600, window: null, trigger: handover };
    if (handover === 'context') ev.session = 'abcdef012345';
    fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), `${JSON.stringify(ev)}\n`);
  }
  return { root, work, dir, slug, now };
}
const tree = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? tree(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`])).sort();
const bytes = (d) => Object.fromEntries(tree(d).map((f) => [f, fs.readFileSync(path.join(d, f)).toString('base64')]));

// The seam: deps.start(argv) records its calls; no helper is ever spawned.
const spy = () => { const calls = []; return { calls, start: (argv) => { calls.push(argv); } }; };
// typer(process.platform) is read at call time; pin the platform for one call.
function onWin32(fn) {
  const d = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', d); }
}
const call = (root, now, s = spy()) => onWin32(() => newSession(root, now, { start: s.start }));
const OPEN = 'The new Lead starts in this terminal once every background task has ended and this turn is over.\nIf it has not started, run in the product folder:\n';

describe('the Contract and the header (lead-session-mcp v2.1)', () => {
  test('the Contract header is v2.1 and the script line 2 declares it', () => {
    const doc = fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-session-mcp.md'), 'utf8');
    assert.match(doc, /^# Contract: lead-session-mcp v2\.1$/m);
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
    assert.match(lines[1], /^\/\/ lead-session-mcp v2\.1 /);
  });

  test('the Contract keeps the v1.2 paragraph: v2, v1.1 and legacy names are byte-identical (isRunSlug)', () => {
    const doc = fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-session-mcp.md'), 'utf8');
    const para = doc.split('\n').find((l) => /^v1\.2\b/.test(l));
    assert.ok(para, 'a `v1.2` paragraph exists');
    assert.match(para, /byte-identical/);
    assert.match(para, /isRunSlug/);
  });
});

describe('lead_new_session on a v3 run', () => {
  test('after a context hand-over it returns the 3-line text naming the command for the slug', () => {
    const fx = fixture({ handover: 'context' });
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.content[0].text, `${OPEN}${newSessionCommand(SLUG)}`);
    assert.equal(r.content[0].text.split('\n').length, 3);
    assert.ok(r.content[0].text.includes(`'${SLUG}'`));
  });

  test('it reads the record in the nested run folder, not a project-level file', () => {
    const fx = fixture({ handover: 'context' });
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.ok(!fs.existsSync(path.join(fx.work, ID, 'lead-handover.jsonl')));
    assert.ok(!fs.existsSync(path.join(fx.work, ID, 'lead-replace.json')), 'armed in the run folder, not the project folder');
  });

  test('a Step running is refused: step running', () => {
    const fx = fixture({ running: true, handover: 'context' });
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, 'refused: step running');
  });

  test('no handover event is refused: no context handover', () => {
    const fx = fixture({ running: true });
    // an open run without a hand-over: make it a clean point so only the missing event refuses
    fs.writeFileSync(path.join(fx.dir, 'run-state.jsonl'), fs.readFileSync(path.join(fx.dir, 'run-state.jsonl'), 'utf8')
      + `${JSON.stringify({ v: 1, at: iso(fx.now - 30000), ev: 'sub', role: 'backend-engineer', id: '000000000001', phase: 'stop' })}\n`);
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, 'refused: no context handover');
  });

  test('a manual or auto handover is refused: no context handover', () => {
    for (const t of ['manual', 'auto']) {
      const fx = fixture({ handover: t });
      const r = call(fx.root, fx.now);
      assert.equal(r.isError, true, t);
      assert.equal(r.content[0].text, 'refused: no context handover', t);
    }
  });

  test('a broken record is refused: broken record', () => {
    const fx = fixture({ handover: 'context' });
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), '{not json}\n');
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, 'refused: broken record');
  });

  test('the call writes only lead-replace.json in the run folder and starts the helper once for the slug', () => {
    const fx = fixture({ handover: 'context' });
    const before = bytes(fx.work);
    const s = spy();
    assert.equal(call(fx.root, fx.now, s).isError, undefined, 'the call succeeds, so the proof of the one write is real');
    const after2 = bytes(fx.work);
    const added = Object.keys(after2).filter((f) => !(f in before));
    assert.deepEqual(added, [`${SLUG}/lead-replace.json`]);
    for (const f of Object.keys(before)) assert.equal(after2[f], before[f], `${f} unchanged`);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0][1], SLUG);
  });

  test('a refusal starts nothing and arms nothing', () => {
    const fx = fixture({ running: true, handover: 'context' });
    const before = bytes(fx.work);
    const s = spy();
    assert.equal(call(fx.root, fx.now, s).isError, true);
    assert.equal(s.calls.length, 0);
    assert.deepEqual(bytes(fx.work), before);
  });

  test('a linked run folder is refused and not followed', () => {
    const fx = fixture({ handover: 'context' });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-out-'));
    tmps.push(outside);
    for (const f of fs.readdirSync(fx.dir)) fs.copyFileSync(path.join(fx.dir, f), path.join(outside, f));
    fs.rmSync(fx.dir, { recursive: true });
    fs.symlinkSync(outside, fx.dir, 'junction');
    const s = spy();
    const r = call(fx.root, fx.now, s);
    assert.equal(r.isError, true);
    assert.equal(s.calls.length, 0, 'nothing started');
    assert.ok(!fs.existsSync(path.join(outside, 'lead-replace.json')), 'nothing armed through the link');
    assert.ok(!r.content[0].text.includes('claude "'));
    assert.doesNotMatch(r.content[0].text, /bad slug/, 'the slug is valid; the link is the reason');
  });

  test('it goes through the protocol: tools/call returns the success text with the command', () => {
    const fx = fixture({ handover: 'context' });
    // handle() has no seam: an arm file already there makes the call start nothing, so no helper is spawned.
    fs.writeFileSync(path.join(fx.dir, 'lead-replace.json'), `${JSON.stringify({ v: 1, session: 'abcdef012345', armAt: iso(fx.now), state: 'waiting-background' })}\n`);
    const line = JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'lead_new_session' } });
    const a = onWin32(() => handle(line, fx.root, fx.now));
    assert.equal(a.id, 5);
    assert.equal(a.result.content[0].text, `${OPEN}${newSessionCommand(SLUG)}`, JSON.stringify(a));
    assert.ok(a.result.content[0].text.includes(`lead-handover read '${SLUG}'`));
  });
});

describe('old names keep their command inside the v2.0 success text', () => {
  test('a legacy run gives the command of today after the two v2.0 lines', () => {
    const fx = fixture({ slug: 'demo-run', handover: 'context' });
    const r = call(fx.root, fx.now);
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.content[0].text,
      `${OPEN}claude "aico lead hand-over: run lead-handover read 'demo-run' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."`);
  });

  test('a legacy run with a Step running keeps its refusal', () => {
    const fx = fixture({ slug: 'demo-run', running: true, handover: 'context' });
    assert.equal(call(fx.root, fx.now).content[0].text, 'refused: step running');
  });
});
