// Tests for lead-handoff v2.1. A Lead hand-over on a v3 run slug `<ID>/<NN>-<playbook>`:
// the run folder is `.company/work/<ID>/<NN>-<playbook>/`; v2, v1.1 and legacy names stay byte-identical.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, contextHandover, newSessionCommand, watch, resume, findRun } from './lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const SCRIPT = path.join(here, 'lead-handover.mjs');
const ID = 'P20261109.000001';
const SLUG = `${ID}/01-feature`;
const SESSION = 'abcdef012345';

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A product root with a v3 project folder and one run folder; `running` leaves a Step open.
function fixture({ slug = SLUG, running = false, cap } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-v3-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  if (slug.includes('/')) fs.writeFileSync(path.join(work, slug.split('/')[0], '00-project.md'), 'Demo project\n');
  const now = Date.now();
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start', ...(cap === undefined ? {} : { cap }) }];
  rows.push({ v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id: '000000000001', phase: 'start' });
  if (!running) rows.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id: '000000000001', phase: 'stop' });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { base, root, claudeDir, work, dir, slug, now };
}
const records = (fx) => fs.readFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tree = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? tree(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`])).sort();
const USAGE_MID = { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 80000, output_tokens: 500 };
function transcript(fx) {
  const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: USAGE_MID } })}\n`);
  return file;
}
const opts = (fx) => ({ root: fx.root, claudeDir: fx.claudeDir, env: { AICO_CONTEXT_GUARD: 'off' } });

describe('the Contract and the header (lead-handoff v2.3)', () => {
  test('the Contract header is v2.3 and the script line 2 declares it', () => {
    const doc = fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-handoff.md'), 'utf8');
    assert.match(doc, /^# Contract: lead-handoff v2\.3$/m);
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
    assert.equal(lines[1], '// contract: docs/contracts/lead-handoff.md v2.3');
  });

  test('line 3 cites run-state v2.1', () => {
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
    assert.match(lines[2], /^\/\/ uses: docs\/contracts\/run-state\.md v2\.1( |$)/);
  });

  test('the Contract has a paragraph saying v2, v1.1 and legacy names are byte-identical', () => {
    const doc = fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-handoff.md'), 'utf8');
    const para = doc.split('\n').find((l) => /^v2\.1\b/.test(l));
    assert.ok(para, 'a `v2.1` paragraph exists');
    assert.match(para, /byte-identical/);
    assert.match(para, /isRunSlug/);
    assert.match(para, /workParts/);
  });
});

describe('newSessionCommand', () => {
  test('a v3 slug gives the single-quoted command with the slug', () => {
    assert.equal(newSessionCommand(SLUG),
      `claude "aico lead hand-over: run lead-handover read '${SLUG}' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."`);
  });

  test('a bad v3 shape gives null', () => {
    for (const bad of [`${SLUG}/x`, `${ID}/../01-feature`, `${ID}\\01-feature`, `${ID}/01-feature/`, `${ID}/1-feature`, '/01-feature', `${ID}//01-feature`, `${SLUG}%`, `${SLUG}"`]) {
      assert.equal(newSessionCommand(bad), null, bad);
    }
  });

  test('a legacy name keeps the exact command of today', () => {
    assert.equal(newSessionCommand('demo-run'),
      'claude "aico lead hand-over: run lead-handover read \'demo-run\' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."');
  });
});

describe('CLI on a v3 slug', () => {
  test('read prints the state lines of the nested run', () => {
    const fx = fixture();
    const r = main(['read', SLUG], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^handovers 0$/m);
    assert.match(r.out, /^running: none$/m);
  });

  test('read reports a Step running in the nested run', () => {
    const fx = fixture({ running: true });
    assert.match(main(['read', SLUG], fx.root, {}).out, /^running: step$/m);
  });

  test('write puts the Handoff and the record in the run folder, slug line holds the slug', () => {
    const fx = fixture();
    const r = main(['write', SLUG], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, 'wrote lead-handoff-1.md\n');
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
    assert.equal(records(fx).find((e) => e.ev === 'handover').file, 'lead-handoff-1.md');
    // nothing lands in the project folder itself
    assert.deepEqual(fs.readdirSync(path.join(fx.work, ID)).sort(), ['00-project.md', '01-feature']);
  });

  test('write refuses with a Step running and writes nothing', () => {
    const fx = fixture({ running: true });
    const before = tree(fx.work);
    const r = main(['write', SLUG], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: step running\n');
    assert.deepEqual(tree(fx.work), before);
  });

  test('begin, base, ctx work on the nested run', () => {
    const fx = fixture();
    assert.equal(main(['begin', SLUG, 'feature'], fx.root, {}).out, 'begun\n');
    assert.equal(main(['base', SLUG, 'a'.repeat(40)], fx.root, {}).out, 'recorded\n');
    const c = main(['ctx', SLUG, '--json'], fx.root, {});
    assert.equal(c.code, 0, c.out);
    assert.deepEqual(JSON.parse(c.out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
    assert.ok(fs.existsSync(path.join(fx.dir, 'lead-handover.jsonl')));
  });

  test('a run that does not exist in an existing project is refused: no run', () => {
    const fx = fixture();
    const r = main(['read', `${ID}/02-feature`], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: no run\n');
  });

  test('a wrong letter case of the run folder is refused and writes nothing', () => {
    const fx = fixture();
    const before = tree(fx.work);
    for (const s of [`${ID}/01-FEATURE`, `${ID.toLowerCase()}/01-feature`]) {
      const r = main(['write', s], fx.root, {});
      assert.equal(r.code, 3, s);
      assert.match(r.out, /^refused: (bad slug|wrong letter case|no run)\n$/);
    }
    assert.deepEqual(tree(fx.work), before);
  });

  test('hostile slugs are refused as bad slug and write nothing', () => {
    const fx = fixture();
    const before = tree(fx.work);
    for (const s of [`${SLUG}/..`, `${ID}/../${ID}/01-feature`, `${ID}\\01-feature`, `${SLUG}/`, `../${SLUG}`, `${ID}/01-feature/extra`]) {
      const r = main(['write', s], fx.root, {});
      assert.equal(r.code, 3, s);
      assert.equal(r.out, 'refused: bad slug\n', s);
    }
    assert.deepEqual(tree(fx.work), before);
  });

  test('a linked project folder is refused and nothing is written through it', () => {
    const fx = fixture({ slug: 'demo-run' });
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(outside, '01-feature', 'run-state.jsonl'));
    fs.symlinkSync(outside, path.join(fx.work, ID), 'junction');
    const before = tree(outside);
    const r = main(['write', SLUG], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /bad slug/, 'the slug is valid; the link is the reason');
    assert.deepEqual(tree(outside), before);
  });

  test('a linked run folder is refused and nothing is written through it', () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(outside, 'run-state.jsonl'));
    fs.rmSync(fx.dir, { recursive: true });
    fs.symlinkSync(outside, fx.dir, 'junction');
    const before = tree(outside);
    const r = main(['write', SLUG], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /bad slug/, 'the slug is valid; the link is the reason');
    assert.deepEqual(tree(outside), before);
  });

  test('a bare project folder name is not a run: nothing written into it', () => {
    const fx = fixture();
    const r = main(['write', ID], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.ok(!fs.readdirSync(path.join(fx.work, ID)).some((f) => f.startsWith('lead-handoff')));
  });
});

describe('hooks and context hand-over on a v3 run', () => {
  test('contextHandover writes the Handoff with the new-session command for the slug', () => {
    const fx = fixture();
    const file = contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now });
    assert.match(String(file), /lead-handoff-1\.md/);
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
    assert.equal(text.trimEnd().split('\n').pop(), `- New session command: ${newSessionCommand(SLUG)}`);
    const rec = records(fx).find((e) => e.ev === 'handover');
    assert.equal(rec.trigger, 'context');
    assert.equal(rec.session, SESSION);
  });

  test('contextHandover refuses a second hand-over of one session', () => {
    const fx = fixture();
    contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now });
    assert.throws(() => contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now }));
  });

  test('findRun finds the active v3 run', () => {
    const fx = fixture({ running: true });
    assert.equal(findRun(fx.root, fx.now), SLUG);
  });

  test('watch on a v3 run writes the Handoff into the run folder', () => {
    const fx = fixture();
    const r = watch(JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: transcript(fx) }), opts(fx));
    assert.equal(r.code, 0);
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
  });

  test('a v3 run keeps its own cap: the running-Step rule of watch follows the recorded cap', () => {
    const fx = fixture({ running: true, cap: 120000 });
    const at = (n) => {
      const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
      fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: n - 15 } } })}
`);
      return JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: file });
    };
    assert.equal(watch(at(119999), opts(fx)).code, 2);
    assert.equal(watch(at(120000), opts(fx)).code, 0);
  });

  test('resume prints the fixed line with the quoted slug', () => {
    const fx = fixture();
    // the run must be active: leave only the start and the Step start rows
    const rows = fs.readFileSync(path.join(fx.dir, 'run-state.jsonl'), 'utf8').trim().split('\n');
    fs.writeFileSync(path.join(fx.dir, 'run-state.jsonl'), `${rows.slice(0, 2).join('\n')}\n`);
    const r = resume(JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }), opts(fx));
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(`lead-handover read '${SLUG}' first`), r.out);
  });

  test('a legacy run still hands over to its flat folder (byte-identical layout)', () => {
    const fx = fixture({ slug: 'demo-run' });
    assert.equal(main(['write', 'demo-run'], fx.root, {}).out, 'wrote lead-handoff-1.md\n');
    const text = fs.readFileSync(path.join(fx.work, 'demo-run', 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes('slug: demo-run'));
  });
});
