import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { CAP, measure, start, main } from './lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'lead-handover.mjs');

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// One product root and one Claude config dir per test; nothing reads the real home.
function fixture({ slug = 'demo-run' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-context-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(now - 60000), ev: 'start' })}\n`);
  return { base, root, claudeDir, dir, slug, file: path.join(dir, 'lead-context.json') };
}

function transcript(fx, total) {
  const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
  const usage = total === null ? {} : { input_tokens: 1000, cache_read_input_tokens: total - 1500, output_tokens: 500 };
  const rows = [
    { type: 'user', message: { role: 'user', content: 'SECRET-PHRASE from the CEO' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-PHRASE reply' }], usage } },
  ];
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

const stop = (file, extra = {}) => JSON.stringify({ hook_event_name: 'Stop', transcript_path: file, ...extra });
const opts = (fx, env = {}) => ({ root: fx.root, claudeDir: fx.claudeDir, env });
const stored = (fx) => JSON.parse(fs.readFileSync(fx.file, 'utf8'));
const leftovers = (fx) => fs.readdirSync(fx.dir).filter((n) => n.includes('lead-context'));

describe('measure', () => {
  test('writes ctx, peak and time, small, LF only, no temp file left', () => {
    const fx = fixture();
    const r = measure(stop(transcript(fx, 40000)), opts(fx));
    assert.deepEqual(r, { code: 0, err: '' });
    const o = stored(fx);
    assert.deepEqual(Object.keys(o), ['v', 'session', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(o.session, null);
    assert.equal(o.v, 1);
    assert.equal(o.ctx, 40000);
    assert.equal(o.peak, 40000);
    assert.match(o.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(fs.statSync(fx.file).size <= 256);
    assert.ok(!fs.readFileSync(fx.file, 'utf8').includes('\r'));
    assert.deepEqual(leftovers(fx), ['lead-context.json']);
  });

  test('peak is the largest reading so far', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 60000)), opts(fx));
    measure(stop(transcript(fx, 20000)), opts(fx));
    assert.equal(stored(fx).ctx, 20000);
    assert.equal(stored(fx).peak, 60000);
    measure(stop(transcript(fx, 70000)), opts(fx));
    assert.equal(stored(fx).peak, 70000);
  });

  test('a corrupt old file counts as no peak', () => {
    const fx = fixture();
    fs.writeFileSync(fx.file, '{"v":1,"ctx":1,"peak":"huge"}\n');
    measure(stop(transcript(fx, 30000)), opts(fx));
    assert.equal(stored(fx).peak, 30000);
  });

  test('a subagent payload writes nothing', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 40000), { agent_id: 'abc' }), opts(fx));
    assert.ok(!fs.existsSync(fx.file));
  });

  test('another event, bad JSON, an array and an oversize payload write nothing', () => {
    const fx = fixture();
    const t = transcript(fx, 40000);
    const bodies = [
      JSON.stringify({ hook_event_name: 'PreCompact', transcript_path: t }),
      '{not json', '[]', 'null',
      stop(t, { pad: 'x'.repeat(70 * 1024) }),
    ];
    for (const b of bodies) assert.deepEqual(measure(b, opts(fx)), { code: 0, err: '' });
    assert.ok(!fs.existsSync(fx.file));
  });

  test('unknown tokens write nothing and keep the old file', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 50000)), opts(fx));
    const before = fs.readFileSync(fx.file, 'utf8');
    measure(stop(transcript(fx, null)), opts(fx));
    measure(stop('relative/path.jsonl'), opts(fx));
    measure(stop(path.join(fx.base, 'missing.jsonl')), opts(fx));
    assert.equal(fs.readFileSync(fx.file, 'utf8'), before);
  });

  test('a transcript outside the projects folder is refused', () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'outside.jsonl');
    fs.copyFileSync(transcript(fx, 40000), outside);
    measure(stop(outside), opts(fx));
    assert.ok(!fs.existsSync(fx.file));
  });

  test('no active run writes nothing', () => {
    const fx = fixture();
    fs.rmSync(path.join(fx.dir, 'run-state.jsonl'));
    measure(stop(transcript(fx, 40000)), opts(fx));
    assert.ok(!fs.existsSync(fx.file));
  });

  test('a directory in the place of the file does not throw and leaves no temp file', () => {
    const fx = fixture();
    fs.mkdirSync(fx.file);
    assert.deepEqual(measure(stop(transcript(fx, 40000)), opts(fx)), { code: 0, err: '' });
    assert.ok(fs.statSync(fx.file).isDirectory());
    assert.deepEqual(leftovers(fx), ['lead-context.json']);
  });

  test('a linked file in the place of the target is not written through', (t) => {
    const fx = fixture();
    const victim = path.join(fx.base, 'victim.txt');
    fs.writeFileSync(victim, 'keep');
    try { fs.symlinkSync(victim, fx.file); } catch { t.skip('no symlink right'); return; }
    measure(stop(transcript(fx, 40000)), opts(fx));
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
  });

  test('the process hook exits 0 and writes the file', () => {
    const fx = fixture();
    const env = { ...process.env, CLAUDE_CONFIG_DIR: fx.claudeDir, HOME: fx.base, USERPROFILE: fx.base, MCSPARROW_HOME: fx.base };
    const r = spawnSync(process.execPath, [SCRIPT, 'measure'], { cwd: fx.root, input: stop(transcript(fx, 41000)), env, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(stored(fx).ctx, 41000);
  });
});

describe('read and ctx', () => {
  const lines = (out) => out.split('\n').filter(Boolean);
  const AT = '2026-11-01T10:00:00Z';

  test('read prints unknown without a file', () => {
    const fx = fixture();
    const l = lines(main(['read', fx.slug], fx.root, {}).out);
    assert.ok(l.includes('lead ctx unknown'));
    assert.ok(l.includes('lead peak unknown'));
  });

  test('read prints ctx and peak, with over cap past CAP', () => {
    const fx = fixture();
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, ctx: 50000, peak: CAP + 1, at: AT })}\n`);
    const l = lines(main(['read', fx.slug], fx.root, {}).out);
    assert.ok(l.includes('lead ctx 50000'));
    assert.ok(l.includes(`lead peak ${CAP + 1} over cap`));
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, ctx: CAP, peak: CAP, at: AT })}\n`);
    assert.ok(lines(main(['read', fx.slug], fx.root, {}).out).includes(`lead peak ${CAP}`));
  });

  test('read prints the session tag of the stored reading, none for an untagged one', () => {
    const fx = fixture();
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, session: 'abc123def456', ctx: 5, peak: 6, at: AT })}
`);
    assert.ok(lines(main(['read', fx.slug], fx.root, {}).out).includes('lead session abc123def456'));
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, session: null, ctx: null, peak: 6, at: AT })}
`);
    assert.ok(lines(main(['read', fx.slug], fx.root, {}).out).includes('lead session none'));
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, ctx: 5, peak: 6, at: AT })}
`);
    assert.ok(lines(main(['read', fx.slug], fx.root, {}).out).includes('lead session none'));
  });

  test('read treats a hostile file as unknown', () => {
    const fx = fixture();
    const bodies = [
      `{"v":1,"ctx":-1,"peak":2,"at":"${AT}"}`,
      `{"v":2,"ctx":1,"peak":2,"at":"${AT}"}`,
      '{"v":1,"ctx":1,"peak":2,"at":"\\u001b[31m"}',
      'nope',
      JSON.stringify({ v: 1, ctx: 1, peak: 2, at: AT, pad: 'x'.repeat(300) }),
    ];
    for (const body of bodies) {
      fs.writeFileSync(fx.file, body);
      const l = lines(main(['read', fx.slug], fx.root, {}).out);
      assert.ok(l.includes('lead ctx unknown'), body);
      assert.ok(l.includes('lead peak unknown'), body);
      assert.ok(l.includes('lead session unknown'), body);
    }
  });

  test('ctx --json prints the stored reading or null fields', () => {
    const fx = fixture();
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, ctx: 5, peak: 9, at: AT })}\n`);
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: 5, peak: 9, at: AT, ttl: null });
  });

  test('ctx refuses a missing flag, a bad slug and a missing run', () => {
    const fx = fixture();
    assert.equal(main(['ctx', fx.slug], fx.root, {}).code, 3);
    assert.equal(main(['ctx', '../x', '--json'], fx.root, {}).code, 3);
    assert.equal(main(['ctx', 'missing-run', '--json'], fx.root, {}).code, 3);
  });
});

describe('begin prints no window warning (v1.7)', () => {
  const begin = (fx, env, playbook = 'feature') => main(['begin', fx.slug, playbook], fx.root, { CLAUDE_CONFIG_DIR: fx.claudeDir, ...env });

  test('begin prints only begun, with or without the window setting in env or user settings', () => {
    const fx = fixture();
    assert.deepEqual(begin(fx, {}), { code: 0, out: 'begun\n' });
    const fy = fixture();
    fs.writeFileSync(path.join(fy.claudeDir, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'zq-settings-val', TOKEN: 'sk-SECRET' } }));
    const r = begin(fy, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'zq-env-val' });
    assert.deepEqual(r, { code: 0, out: 'begun\n' });
  });

  test('begin reads no settings file', () => {
    const src = fs.readFileSync(path.join(here, 'lead-handover.mjs'), 'utf8');
    assert.ok(!src.includes('settings.json'));
    assert.ok(!src.includes('windowWarning'));
  });

  test('a refused begin prints no warning', () => {
    const fx = fixture();
    const r = begin(fx, {}, 'no-such-playbook');
    assert.equal(r.code, 3);
    assert.ok(!r.out.includes('warning'));
  });
});

describe('read refuses what is not exactly the named file (proj.M-SEC7)', () => {
  const AT = '2026-11-01T10:00:00Z';
  const body = `${JSON.stringify({ v: 1, ctx: 5, peak: 9, at: AT })}\n`;

  test('a hard-linked reading file is unknown', () => {
    const fx = fixture();
    const other = path.join(fx.base, 'other.json');
    fs.writeFileSync(other, body);
    fs.linkSync(other, fx.file);
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
  });

  test('a symlinked reading file pointing outside the run is unknown', (t) => {
    const fx = fixture();
    const other = path.join(fx.base, 'other.json');
    fs.writeFileSync(other, body);
    try {
      fs.symlinkSync(other, fx.file);
    } catch {
      t.skip('symlinks not available');
      return;
    }
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
  });

  test('a file whose real name differs in letter case is unknown', (t) => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'LEAD-CONTEXT.JSON'), body);
    if (fs.existsSync(path.join(fx.dir, 'lead-context.json')) === false) { t.skip('case-sensitive folder'); return; }
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
  });
});

// Lead hand-over loop fix: the reading is tagged with the session (first 12 hex of sha256 of the session id).
const tag = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
const begin = (extra = {}) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-b', ...extra });

describe('per-session reading', () => {
  test('measure stores the session tag, never the session id', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 40000), { session_id: 'sess-a' }), opts(fx));
    const o = stored(fx);
    assert.equal(o.session, tag('sess-a'));
    assert.ok(!fs.readFileSync(fx.file, 'utf8').includes('sess-a'));
  });

  test('a new session keeps the run-wide peak and takes its own ctx', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 147000), { session_id: 'sess-a' }), opts(fx));
    measure(stop(transcript(fx, 60000), { session_id: 'sess-b' }), opts(fx));
    const o = stored(fx);
    assert.equal(o.session, tag('sess-b'));
    assert.equal(o.ctx, 60000);
    assert.equal(o.peak, 147000);
  });

  test('start: a fresh session resets ctx to unknown, keeps peak, tags the session', () => {
    const fx = fixture();
    measure(stop(transcript(fx, 147000), { session_id: 'sess-a' }), opts(fx));
    assert.deepEqual(start(begin(), opts(fx)), { code: 0, err: '' });
    const o = stored(fx);
    assert.deepEqual(Object.keys(o), ['v', 'session', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(o.session, tag('sess-b'));
    assert.equal(o.ctx, null);
    assert.equal(o.peak, 147000);
    const read = main(['read', fx.slug], fx.root, {}).out.split('\n');
    assert.ok(read.includes('lead ctx unknown'), read.join('|'));
    assert.ok(read.includes('lead peak 147000 over cap'));
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: 147000, at: o.at, ttl: null });
  });

  test('start works for resume and clear, writes a peak of 0 on a first run, and ignores compact and subagents', () => {
    for (const source of ['resume', 'clear']) {
      const fx = fixture();
      start(begin({ source }), opts(fx));
      assert.deepEqual([stored(fx).ctx, stored(fx).peak], [null, 0]);
    }
    const fx = fixture();
    measure(stop(transcript(fx, 50000), { session_id: 'sess-a' }), opts(fx));
    const before = fs.readFileSync(fx.file, 'utf8');
    start(begin({ source: 'compact' }), opts(fx));
    start(begin({ agent_id: 'x' }), opts(fx));
    start(begin({ session_id: 7 }), opts(fx));
    start('{not json', opts(fx));
    assert.equal(fs.readFileSync(fx.file, 'utf8'), before);
  });

  test('start with no active run writes nothing', () => {
    const fx = fixture();
    fs.rmSync(path.join(fx.dir, 'run-state.jsonl'));
    start(begin(), opts(fx));
    assert.ok(!fs.existsSync(fx.file));
  });

  test('a v1.7 file with four keys is still read (no session), and the next measure rewrites it tagged', () => {
    const fx = fixture();
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, ctx: 90000, peak: 120000, at: '2026-11-03T07:43:00Z' })}
`);
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: 90000, peak: 120000, at: '2026-11-03T07:43:00Z', ttl: null });
    measure(stop(transcript(fx, 30000), { session_id: 'sess-a' }), opts(fx));
    assert.equal(stored(fx).peak, 120000);
    assert.equal(stored(fx).session, tag('sess-a'));
  });

  test('the process hook start exits 0 and writes the reset', () => {
    const fx = fixture();
    const env = { ...process.env, CLAUDE_CONFIG_DIR: fx.claudeDir, HOME: fx.base, USERPROFILE: fx.base, MCSPARROW_HOME: fx.base };
    const r = spawnSync(process.execPath, [SCRIPT, 'start'], { cwd: fx.root, input: begin(), env, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(stored(fx).ctx, null);
  });

  test('hooks.json wires start to SessionStart startup|resume|clear', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(here, '..', 'hooks', 'hooks.json'), 'utf8'));
    const e = cfg.hooks.SessionStart.find((x) => x.matcher === 'startup|resume|clear');
    assert.ok(e);
    assert.match(e.hooks[0].command, /lead-handover\.mjs" start$/);
  });
});
