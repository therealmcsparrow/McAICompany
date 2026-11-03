import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, show, active } from './run-state.mjs';
import { main as handover, watch, resume } from './lead-handover.mjs';
import { handle } from './step-times.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN_STATE = path.join(here, 'run-state.mjs');
const AGENTS = path.join(here, '..', 'agents');

const NEW = '2026-10-31 09.15 - Resume Demo';
const NEW_BUILD = '2026-10-31 09.15 - Resume Demo Build';
const NEW_DRAFT_2 = '2026-10-31 09.20 - Resume Demo Draft 2';
const LEGACY = 'demo-run';

// Names no script may accept as a work folder, with the reason each one is hostile.
const HOSTILE = [
  '..', '.', '../x', 'a/b', 'a\\b', '/abs', 'C:\\x', '',
  "2026-10-31 09.15 - It's", '2026-10-31 09.15 - $(touch x)', '2026-10-31 09.15 - A;B', '2026-10-31 09.15 - A`B`',
  '2026-10-31 09.15 - ', '2026-10-31 09.15 -  Resume', '2026-10-31 09.15 - Resume ', ' 2026-10-31 09.15 - Resume',
  '2026-10-31 09.15 - resume', '2026-10-31 09.15 - Resume\nDemo', '2026-10-31 09.15 - Resume\r', '2026-10-31 09.15 - Resume\u202e',
  '2026-10-31 09.15 - Build', '2026-10-31 09.15 - Resume Build 2', '2026-10-31 09.15 - Resume Draft 1',
  '2026-13-31 09.15 - Resume', '2026-02-30 09.15 - Resume', '2026-10-31 24.15 - Resume', '2026-10-31 09.60 - Resume',
  '2026-10-31 09:15 - Resume', '2026-10-31T09.15 - Resume', '2026-10-31 09.15 Resume', '2026-10-31 09.15 - Rés',
  '2026-10-31 09.15 - Resume Demo Extra Words Over Five', `2026-10-31 09.15 - ${'A'.repeat(70)}`,
  'Demo', 'demo run', 'demo.run', '-demo', 'x'.repeat(65), 'x'.repeat(5000),
];

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-runs-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  const claudeDir = path.join(base, 'claude');
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  return { base, root, claudeDir, work: path.join(root, '.company', 'work') };
}

const names = (fx) => fs.readdirSync(fx.work).sort();

function startRun(fx, name, now) {
  const r = run(['start', name], { root: fx.root, now });
  assert.deepEqual(r, { out: `ok: start ${name}`, code: 0 });
}

const sessionStart = JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' });

describe('run-state on a new name and on a legacy slug', () => {
  for (const name of [NEW, NEW_BUILD, NEW_DRAFT_2, LEGACY]) {
    test(`start and show: ${name}`, () => {
      const fx = fixture();
      const now = Date.now();
      startRun(fx, name, now);
      assert.deepEqual(names(fx), [name]);
      const view = show(fx.root, name, { now });
      assert.equal(view.slug, name);
      assert.equal(view.state, 'running');
      assert.equal(JSON.parse(run(['show', name, '--json'], { root: fx.root, now }).out).slug, name);
      assert.equal(run(['wave', name, '1'], { root: fx.root, now }).code, 0);
      assert.equal(active(fx.root, { now }).slug, name);
      assert.equal(run(['end', name, 'ship'], { root: fx.root, now }).code, 0);
    });
  }

  test('a legacy folder keeps its name and its records through start, end and a second start', () => {
    const fx = fixture();
    const now = Date.now();
    startRun(fx, LEGACY, now);
    assert.equal(run(['end', LEGACY, 'abort'], { root: fx.root, now }).code, 0);
    startRun(fx, LEGACY, now + 1000);
    assert.deepEqual(names(fx), [LEGACY]);
    assert.deepEqual(fs.readdirSync(path.join(fx.work, LEGACY)), ['run-state.jsonl']);
  });

  test('a new name and a legacy slug in one work folder: the newer run is the active one', () => {
    const fx = fixture();
    const now = Date.now();
    startRun(fx, LEGACY, now - 5000);
    startRun(fx, NEW, now);
    assert.equal(active(fx.root, { now }).slug, NEW);
  });

  test('every hostile name is refused by every command with no echo and nothing created', () => {
    const fx = fixture();
    const now = Date.now();
    const id = 'a'.repeat(12);
    for (const bad of HOSTILE) {
      const calls = [
        ['start', bad], ['wave', bad, '1'], ['ceo', bad, 'brief', '1'], ['sub', bad, 'start', 'other', id],
        ['ask', bad, 'brief'], ['gate', bad, 'brief', 'passed'], ['pick', bad, 'use', '0'], ['end', bad, 'ship'], ['show', bad, '--json'],
      ];
      for (const argv of calls) {
        const r = run(argv, { root: fx.root, now });
        assert.equal(r.code, 2, JSON.stringify(argv));
        assert.equal(r.out, 'refused: bad slug', JSON.stringify(argv));
      }
      assert.throws(() => show(fx.root, bad, { now }), /bad slug/);
    }
    assert.deepEqual(names(fx), []);
  });

  test('a folder with a refused name is never read by active', () => {
    const fx = fixture();
    const now = Date.now();
    for (const bad of ['demo run', 'Demo', '2026-10-31 09.15 - resume', "2026-10-31 09.15 - It's"]) {
      const dir = path.join(fx.work, bad);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(now), ev: 'start' })}\n`);
    }
    assert.deepEqual(active(fx.root, { now }), { slug: null, view: null });
  });

  test('a work folder name that is a link is not followed', () => {
    const fx = fixture();
    const now = Date.now();
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(now), ev: 'start' })}\n`);
    fs.symlinkSync(outside, path.join(fx.work, NEW), 'junction');
    assert.deepEqual(active(fx.root, { now }), { slug: null, view: null });
    const view = show(fx.root, NEW, { now });
    assert.equal(view.state, 'none');
    assert.equal(run(['wave', NEW, '1'], { root: fx.root, now }).code, 2);
    assert.deepEqual(fs.readdirSync(outside), ['run-state.jsonl']);
  });
});

describe('lead-handover on a new name and on a legacy slug', () => {
  for (const name of [NEW, NEW_DRAFT_2, LEGACY]) {
    test(`read, write and resume: ${name}`, () => {
      const fx = fixture();
      const now = Date.now();
      startRun(fx, name, now - 60000);
      const read = handover(['read', name], fx.root, {});
      assert.equal(read.code, 0);
      assert.match(read.out, /^handovers 0\nresumes hook 0 ceo 0\nlast none\n/);
      const wrote = handover(['write', name], fx.root, {});
      assert.deepEqual(wrote, { code: 0, out: 'wrote lead-handoff-1.md\n' });
      assert.deepEqual(names(fx), [name]);
      const body = fs.readFileSync(path.join(fx.work, name, 'lead-handoff-1.md'), 'utf8');
      assert.equal(body.split('\n')[1], `slug: ${name}`);
      assert.equal(body.includes('\r'), false);
      const r = resume(sessionStart, { root: fx.root, claudeDir: fx.claudeDir, env: {}, now });
      assert.equal(r.code, 0);
      const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes(`slug: ${name}`), 'the valid Handoff is injected for the name');
      assert.match(handover(['read', name], fx.root, {}).out, /^handovers 1\nresumes hook 0 ceo 1\n/);
    });

    test(`the hook line prints the name single-quoted: ${name}`, () => {
      const fx = fixture();
      const now = Date.now();
      startRun(fx, name, now - 60000);
      const r = resume(sessionStart, { root: fx.root, claudeDir: fx.claudeDir, env: {}, now });
      const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
      assert.equal(ctx, `aico lead hand-over: run lead-handover read '${name}' first, then follow skills/pipeline/references/lead-resume.md.`);
    });
  }

  test('watch writes the Handoff for a new name', () => {
    const fx = fixture();
    const now = Date.now();
    startRun(fx, NEW, now - 60000);
    const file = path.join(fx.claudeDir, 'projects', 'p1', 's.jsonl');
    fs.writeFileSync(file, '');
    const payload = JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: file });
    assert.deepEqual(watch(payload, { root: fx.root, claudeDir: fx.claudeDir, env: {}, now }), { code: 0, err: '' });
    assert.ok(fs.existsSync(path.join(fx.work, NEW, 'lead-handoff-1.md')));
  });

  test('a Handoff whose slug line is another valid name is not injected', () => {
    const fx = fixture();
    const now = Date.now();
    startRun(fx, NEW, now - 60000);
    assert.equal(handover(['write', NEW], fx.root, {}).code, 0);
    const file = path.join(fx.work, NEW, 'lead-handoff-1.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`slug: ${NEW}`, `slug: ${NEW_BUILD}`));
    const ctx = JSON.parse(resume(sessionStart, { root: fx.root, claudeDir: fx.claudeDir, env: {}, now }).out).hookSpecificOutput.additionalContext;
    assert.equal(ctx.includes('slug:'), false);
    assert.ok(ctx.includes(`read '${NEW}' first`));
  });

  test('every hostile name is refused by every command with no echo and nothing created', () => {
    const fx = fixture();
    for (const bad of HOSTILE) {
      for (const argv of [['read', bad], ['write', bad], ['begin', bad, 'feature'], ['base', bad, 'a'.repeat(40)]]) {
        const r = handover(argv, fx.root, {});
        assert.equal(r.code, 3, JSON.stringify(argv));
        assert.match(r.out, /^refused: (bad slug|argument is not accepted)\n$/, JSON.stringify(argv));
        if (bad.length >= 3) assert.equal(r.out.includes(bad), false, 'the refusal does not echo the name');
      }
    }
    assert.deepEqual(names(fx), []);
  });

  test('a valid name with no folder is refused as no run', () => {
    const fx = fixture();
    assert.deepEqual(handover(['read', NEW], fx.root, {}), { code: 3, out: 'refused: no run\n' });
  });

  test('a new name whose folder is a link is refused', () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(fx.work, NEW), 'junction');
    assert.deepEqual(handover(['read', NEW], fx.root, {}), { code: 3, out: 'refused: no run\n' });
    assert.deepEqual(handover(['write', NEW], fx.root, {}), { code: 3, out: 'refused: no run\n' });
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('a new name whose work folder parent is a link is refused', () => {
    const fx = fixture();
    const real = path.join(fx.base, 'elsewhere');
    fs.mkdirSync(path.join(real, NEW), { recursive: true });
    fs.rmSync(fx.work, { recursive: true });
    fs.symlinkSync(real, fx.work, 'junction');
    assert.deepEqual(handover(['read', NEW], fx.root, {}), { code: 3, out: 'refused: no run\n' });
  });

  test('the fallback scan finds an open idea flow under a new name and skips refused names', () => {
    const fx = fixture();
    const now = Date.now();
    for (const bad of ['demo run', "2026-10-31 09.15 - It's"]) {
      fs.mkdirSync(path.join(fx.work, bad));
      fs.writeFileSync(path.join(fx.work, bad, 'idea-flow.jsonl'), '{}\n');
    }
    const r = resume(sessionStart, { root: fx.root, claudeDir: fx.claudeDir, env: {}, now });
    assert.deepEqual(r, { code: 0, out: '' });
  });
});

describe('step-times on a new name', () => {
  test('the sub event goes to the run with a new name', async () => {
    const fx = fixture();
    startRun(fx, NEW, Date.now());
    const text = JSON.stringify({ agent_id: 'agent-1', agent_type: 'backend-engineer' });
    await handle(text, 'start', { runStatePath: RUN_STATE, cwd: fx.root, agentsDir: AGENTS });
    const view = show(fx.root, NEW);
    assert.equal(view.subs.length, 1);
    assert.equal(view.subs[0].role, 'backend-engineer');
  });

  test('the sub event goes to a legacy run', async () => {
    const fx = fixture();
    startRun(fx, LEGACY, Date.now());
    await handle(JSON.stringify({ agent_id: 'agent-1' }), 'start', { runStatePath: RUN_STATE, cwd: fx.root, agentsDir: AGENTS });
    assert.equal(show(fx.root, LEGACY).subs.length, 1);
  });

  test('a refused name from the active record writes nothing', async () => {
    const fx = fixture();
    const fake = path.join(fx.base, 'fake-run-state.mjs');
    const log = path.join(fx.base, 'calls.log');
    fs.writeFileSync(fake, [
      "import fs from 'node:fs';",
      `fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join('|') + '\\n');`,
      "if (process.argv[2] === 'active') process.stdout.write(JSON.stringify({ slug: process.env.FAKE_SLUG, view: null }));",
    ].join('\n'));
    const text = JSON.stringify({ agent_id: 'agent-1' });
    for (const bad of ["x' y", '2026-10-31 09.15 - resume', '../x', 'a b']) {
      process.env.FAKE_SLUG = bad;
      await handle(text, 'start', { runStatePath: fake, cwd: fx.root, agentsDir: AGENTS });
    }
    process.env.FAKE_SLUG = NEW;
    await handle(text, 'start', { runStatePath: fake, cwd: fx.root, agentsDir: AGENTS });
    delete process.env.FAKE_SLUG;
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.filter((c) => c.startsWith('sub|')).length, 1);
    assert.ok(calls.some((c) => c.startsWith(`sub|${NEW}|start|`)));
  });
});
