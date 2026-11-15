import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// QA tests for P20261115.000001-T9 (scripts/lead-replace.mjs), written before the build; red until it lands.
// Spec: docs/contracts/lead-session-mcp.md `## Helper`. The seams are the Contract's, with the injectable deps pinned here:
//   backgroundDone({ dir, session, claudePid, list, alive, now, sleep }) -> 'done' | 'failed: session gone'
//     list(claudePid) -> [{ pid, image, created }] (direct children; created = epoch ms); alive(pid) -> boolean.
//   turnOver({ dir, session, armAt, now, sleep }) -> 'done' | 'failed: turn'      (armAt = ISO string)
//   typeInto(text, { platform, run, dir, session, claudePid, now, sleep }) -> 'typed' | 'unsupported' | 'failed: attach' | 'failed: type' | 'failed: clear'
//     run(argv, input) -> { status } is the process runner (the powershell typer); session = the frozen session.
//   now() is the clock in epoch ms, sleep(ms) is awaited; the fakes below advance the clock, no test waits for real.
// The CLI is `node scripts/lead-replace.mjs <slug> <claudePid>`.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const SCRIPT = path.join(repo, 'scripts', 'lead-replace.mjs');
const load = () => import(pathToFileURL(SCRIPT).href);

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const SLUG = 'P20261115.000001/01-fix';
const FROZEN = 'abcdef012345';
const CLAUDE = 4242;

function runDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-replace-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'P20261115.000001', '01-fix');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}
const guard = (dir, rows) => fs.writeFileSync(path.join(dir, 'guard.jsonl'),
  rows.map((r) => `${JSON.stringify({ v: 1, ...r })}\n`).join(''));
const reading = (dir, session, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'),
  `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 170000, at: iso(atMs), ttl: null })}\n`);

// Fake clock: sleep advances time; a runaway loop with a zero or tiny sleep is cut off.
function clock(start = T0, onTick = () => {}) {
  const c = { t: start, sleeps: [], calls: 0 };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.calls += 1;
    if (c.calls > 100000) throw new Error('runaway wait loop');
    c.sleeps.push(ms);
    c.t += ms;
    onTick(c.t);
  };
  return c;
}

// list() answering from a poll script: poll n (0-based) returns script(n).
function lister(script) {
  const l = { polls: 0 };
  l.list = async () => { const rows = script(l.polls); l.polls += 1; return rows; };
  return l;
}
const shell = (pid, image = 'cmd.exe', created = T0 + 5000) => ({ pid, image, created });
const BG = { ev: 'bg', session: FROZEN, at: iso(T0) };

describe('backgroundDone (Helper item 1)', () => {
  test('no bg row -> done at once, list never polled', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [{ ev: 'stop', id: 'x', at: iso(T0) }]);
    const l = lister(() => [shell(50)]);
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
    assert.equal(l.polls, 0);
  });

  test('no guard record at all -> done at once', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    const l = lister(() => [shell(50)]);
    const c = clock();
    assert.equal(await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep }), 'done');
    assert.equal(l.polls, 0);
  });

  test('a shell pid in one poll only is not live: done within three polls', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister((n) => (n === 0 ? [shell(50)] : []));
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
    assert.ok(l.polls >= 2 && l.polls <= 3, `polls ${l.polls}`);
  });

  test('the same pid in two polls in a row is live: waits until it is gone for two polls', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister((n) => (n < 4 ? [shell(50)] : []));   // present polls 0-3, gone from poll 4
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
    assert.ok(l.polls >= 6 && l.polls <= 7, `done after the pid was gone two polls in a row, polls ${l.polls}`);
  });

  test('a pid that comes back after one empty poll keeps the task live', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    // present 0,1 (live), gone 2, present 3,4 (live again), gone 5.. -> must not finish before poll 7 (two empty in a row: 5,6)
    const l = lister((n) => ([0, 1, 3, 4].includes(n) ? [shell(50)] : []));
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
    assert.ok(l.polls >= 7, `polls ${l.polls}`);
  });

  test('polls every 2 s', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister((n) => (n < 3 ? [shell(50)] : []));
    const c = clock();
    await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.ok(c.sleeps.length > 0 && c.sleeps.every((ms) => ms === 2000), `sleeps ${c.sleeps.join(',')}`);
  });

  test('a child created before the first bg `at` is ignored', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister(() => [shell(50, 'cmd.exe', T0 - 60000)]);   // always there, but older than the launch
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
    assert.ok(l.polls <= 3, `polls ${l.polls}`);
  });

  test('the first bg row sets the cutoff, later rows do not move it', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG, { ev: 'bg', session: FROZEN, at: iso(T0 + 600000) }]);
    const l = lister((n) => (n < 4 ? [shell(50, 'cmd.exe', T0 + 1000)] : []));
    const c = clock();
    await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.ok(l.polls >= 6, `the child created after the first row counts, polls ${l.polls}`);
  });

  test('only shell images count: node.exe and conhost.exe children are ignored', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister(() => [shell(60, 'node.exe'), shell(61, 'conhost.exe')]);
    const c = clock();
    assert.equal(await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep }), 'done');
    assert.ok(l.polls <= 3, `polls ${l.polls}`);
  });

  test('every shell image form counts as live (bash, sh, pwsh, powershell, cmd, with or without .exe)', async () => {
    const { backgroundDone } = await load();
    for (const image of ['bash', 'bash.exe', 'sh', 'sh.exe', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']) {
      const { dir } = runDir();
      guard(dir, [BG]);
      const l = lister((n) => (n < 4 ? [shell(70, image)] : []));
      const c = clock();
      await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
      assert.ok(l.polls >= 6, `${image} must count as live, polls ${l.polls}`);
    }
  });

  test('claude pid gone while waiting -> failed: session gone', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister(() => [shell(50)]);   // never ends
    let alive = true;
    const c = clock(T0, (t) => { if (t >= T0 + 10000) alive = false; });
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => alive, now: c.now, sleep: c.sleep });
    assert.equal(r, 'failed: session gone');
  });

  test('no time limit: a task live for 3 hours is still waited for', async () => {
    const { backgroundDone } = await load();
    const { dir } = runDir();
    guard(dir, [BG]);
    const l = lister((n) => (n < 5400 ? [shell(50)] : []));   // 5400 polls x 2 s = 3 h
    const c = clock();
    const r = await backgroundDone({ dir, session: FROZEN, claudePid: CLAUDE, list: l.list, alive: () => true, now: c.now, sleep: c.sleep });
    assert.equal(r, 'done');
  });
});

describe('turnOver (Helper item 2)', () => {
  test('lead-context.json naming the session at or after armAt -> done', async () => {
    const { turnOver } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock(T0 + 1000);
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), now: c.now, sleep: c.sleep }), 'done');
  });

  test('a reading older than armAt does not count; a Stop reading written later does', async () => {
    const { turnOver } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0 - 30000);
    const c = clock(T0, (t) => { if (t >= T0 + 40000) reading(dir, FROZEN, T0 + 40000); });
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), now: c.now, sleep: c.sleep }), 'done');
    assert.ok(c.t >= T0 + 40000, 'must not return before the new reading');
  });

  test('a reading of another session does not count', async () => {
    const { turnOver } = await load();
    const { dir } = runDir();
    reading(dir, 'ffffffffffff', T0 + 1000);
    const c = clock();
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), now: c.now, sleep: c.sleep }), 'failed: turn');
  });

  test('no file at all -> failed: turn after 10 min (not before, not long after)', async () => {
    const { turnOver } = await load();
    const { dir } = runDir();
    const c = clock();
    const r = await turnOver({ dir, session: FROZEN, armAt: iso(T0), now: c.now, sleep: c.sleep });
    assert.equal(r, 'failed: turn');
    const waited = c.t - T0;
    assert.ok(waited >= 600000 && waited <= 660000, `waited ${waited} ms`);
  });

  test('a reading arriving just inside 10 min is still accepted', async () => {
    const { turnOver } = await load();
    const { dir } = runDir();
    const c = clock(T0, (t) => { if (t >= T0 + 590000) reading(dir, FROZEN, T0 + 590000); });
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), now: c.now, sleep: c.sleep }), 'done');
  });
});

describe('typeInto (Helper item 3)', () => {
  const PROMPT = 'aico lead hand-over: run lead-handover read \'P20261115.000001/01-fix\' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file.';

  // Runner fake: records calls; typing /clear makes SessionStart write a new session unless `noClear`.
  function runner(dir, c, { noClear = false, status = () => 0 } = {}) {
    const r = { calls: [] };
    r.run = async (argv, input) => {
      const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
      r.calls.push({ argv, text, at: c.t });
      if (text.startsWith('/clear') && !noClear) reading(dir, 'newsession001', c.t + 500);
      return { status: status(r.calls.length) };
    };
    return r;
  }

  test('typed: /clear + Enter first, then the prompt + Enter after the new session shows', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c);
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'typed');
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls[0].text, '/clear\r');
    assert.equal(r.calls[1].text, `${PROMPT}\r`);
  });

  test('the runner is the Windows typer: powershell, Bypass, -File console-type.ps1, --pid <claudePid>', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c);
    await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    for (const call of r.calls) {
      const argv = call.argv.map(String);
      assert.match(argv[0], /powershell(\.exe)?$/i);
      assert.ok(argv.includes('-NoProfile') && argv.includes('-NonInteractive'), argv.join(' '));
      assert.equal(argv[argv.indexOf('-ExecutionPolicy') + 1], 'Bypass');
      assert.match(argv[argv.indexOf('-File') + 1], /scripts[\\/]lib[\\/]console-type\.ps1$/);
      assert.equal(argv[argv.indexOf('--pid') + 1], String(CLAUDE));
    }
  });

  test('no clear seen within 15 s -> failed: clear, and the prompt is never typed', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c, { noClear: true });
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'failed: clear');
    assert.equal(r.calls.length, 1, 'only /clear was typed');
    const waited = c.t - r.calls[0].at;
    assert.ok(waited >= 15000 && waited <= 20000, `waited ${waited} ms`);
  });

  test('clear seen at 14 s is still accepted', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock(T0, (t) => { if (t >= T0 + 14000) reading(dir, 'newsession001', t); });
    const r = runner(dir, c, { noClear: true });
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'typed');
  });

  test('typer exit 1 -> failed: attach; nothing further is typed', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c, { status: () => 1 });
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'failed: attach');
    assert.equal(r.calls.length, 1);
  });

  test('typer exit 2 -> failed: type', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c, { status: () => 2 });
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'failed: type');
  });

  test('typer exit 1 on the prompt (second call) -> failed: attach', async () => {
    const { typeInto } = await load();
    const { dir } = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c, { status: (n) => (n === 2 ? 1 : 0) });
    const out = await typeInto(PROMPT, { platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
    assert.equal(out, 'failed: attach');
    assert.equal(r.calls.length, 2);
  });

  test('other platforms -> unsupported, nothing typed', async () => {
    const { typeInto } = await load();
    for (const platform of ['linux', 'darwin']) {
      const { dir } = runDir();
      reading(dir, FROZEN, T0);
      const c = clock();
      const r = runner(dir, c);
      const out = await typeInto(PROMPT, { platform, run: r.run, dir, session: FROZEN, claudePid: CLAUDE, now: c.now, sleep: c.sleep });
      assert.equal(out, 'unsupported', platform);
      assert.equal(r.calls.length, 0, platform);
    }
  });
});

describe('CLI argv check (exit 2, no file)', () => {
  const bad = [
    ['no arguments', []],
    ['slug only', [SLUG]],
    ['non-numeric pid', [SLUG, '12a']],
    ['pid zero', [SLUG, '0']],
    ['pid with leading zero', [SLUG, '0123']],
    ['negative pid', [SLUG, '-5']],
    ['slug with a shell character', ['P20261115.000001/01-fix;calc', '123']],
    ['slug with a quote', ["P20261115.000001/01-fix'", '123']],
    ['not a slug', ['not-a-slug', '123']],
    ['path traversal slug', ['../../etc/passwd', '123']],
    ['extra argument', [SLUG, '123', 'extra']],
  ];
  for (const [name, args] of bad) {
    test(`${name} -> exit 2, no lead-replace.json written`, () => {
      const { root, dir } = runDir();
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 2, `stderr: ${r.stderr}`);
      assert.equal(fs.existsSync(path.join(dir, 'lead-replace.json')), false);
      const stray = fs.readdirSync(dir).filter((f) => f.includes('lead-replace'));
      assert.deepEqual(stray, []);
    });
  }
});
