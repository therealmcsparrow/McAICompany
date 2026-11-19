// Bug P20261119.000001 (a), lead-relay v1.1: main may never get the Lead's STATUS (the platform backgrounds the spawn). The hook host
// keeps the final STATUS block of a Lead (leadStart / leadStop, no CLI word writes it) and `lead-relay result` prints it. Hostile
// and stale cases: planted links, traversal slug, oversize, multi-byte, bidi/control chars, helper Lead, blocked stop, old result.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, leadStart, leadStop } from '../../scripts/lead-relay.mjs';
import { judge, judgeRecord } from '../../hooks/rules/self-protect.mjs';
import { capEnv, cleanup, LEAD_TYPE } from '../context-guard/cap-engine.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261119.000009';
const SLUG = `${ID}/02-lead`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-result-'));
const state = path.join(root, 'state');
after(() => { fs.rmSync(root, { recursive: true, force: true }); cleanup(); });
const dirOf = (slug) => path.join(root, '.company', 'work', ...slug.split('/'));
const mkRun = (slug) => {
  fs.mkdirSync(dirOf(slug), { recursive: true });
  fs.writeFileSync(path.join(dirOf(slug), 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: '2026-11-19T10:00:00Z', ev: 'start' })}\n`);
};
mkRun(SLUG);
const RS = path.join(path.dirname(SCRIPT), 'run-state.mjs');
const rsEnv = { ...process.env, MCSPARROW_HOME: path.join(root, 'home') };
const endRun = (slug) => {
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo\n');
  const r = spawnSync(process.execPath, [RS, 'end', slug, 'ship'], { cwd: root, encoding: 'utf8', env: rsEnv });
  const s = spawnSync(process.execPath, [RS, 'show', slug, '--json'], { cwd: root, encoding: 'utf8', env: rsEnv });
  assert.match(s.stdout, /ended/, `precondition: run ended: ${r.stdout}${r.stderr}`);
};
const resultFile =(slug = SLUG) => path.join(dirOf(slug), 'lead-result.txt');
const result = (...a) => main(['result', ...a], root);
const block = (extra = 'summary: ok', slug = SLUG) => `STATUS: done\nrun: .company/work/${slug}\n${extra}`;
const ev = (name, over = {}) => JSON.stringify({ hook_event_name: name, agent_id: 'a1', agent_type: LEAD_TYPE, ...over });
const start = (id = 'a1') => leadStart(ev('SubagentStart', { agent_id: id }), root, state);
const stop = (msg, id = 'a1') => leadStop(ev('SubagentStop', { agent_id: id, last_assistant_message: msg }), root, state);
const reset = () => { fs.rmSync(state, { recursive: true, force: true }); fs.rmSync(resultFile(), { force: true }); };

test('result is none before a Lead stopped', () => {
  reset();
  assert.match(result(SLUG).out, /result: none/);
  assert.match(result().out, /result: none/);
});

test('a Lead start then stop records the block, result prints it (slug and no slug)', () => {
  reset();
  start();
  stop(block());
  for (const r of [result(SLUG), result()]) {
    assert.equal(r.code, 0);
    assert.match(r.out, /^recorded: \S+\nSTATUS: done\nrun: .company\/work\/P20261119.000009\/02-lead\nsummary: ok\n$/);
  }
});

test('no hook word and no CLI word writes a result: record and any other word are usage refusals', () => {
  reset();
  for (const w of ['record', 'leadStop']) {
    const r = spawnSync(process.execPath, [SCRIPT, w], { cwd: root, encoding: 'utf8', input: ev('SubagentStop', { last_assistant_message: block() }), timeout: 20000 });
    assert.equal(r.status, 1);
    assert.equal(fs.existsSync(resultFile()), false);
  }
});

test('only a Lead payload counts: a Role, a missing agent_type, a wrong event, no STATUS line, an unknown run', () => {
  reset();
  start();
  leadStop(ev('SubagentStop', { agent_type: 'aico:qa', last_assistant_message: block() }), root, state);
  leadStop(ev('SubagentStop', { agent_type: undefined, last_assistant_message: block() }), root, state);
  leadStop(ev('SubagentStart', { last_assistant_message: block() }), root, state);
  stop(`all good\nrun: .company/work/${SLUG}`);
  stop(block('x', 'P20261119.000008/01-x'));
  stop(block('x', '../../etc/02-x'));
  stop(`STATUS: done\nrun: .company/work/${ID}/../../x`);
  assert.equal(fs.existsSync(resultFile()), false);
  assert.equal(fs.existsSync(path.join(root, '.company', 'work', 'P20261119.000008')), false);
  assert.match(result(SLUG).out, /result: none/);
});

test('a helper Lead stop is not recorded; the outer Lead stop is', () => {
  reset();
  start('outer');
  start('helper');
  stop(block('summary: helper'), 'helper');
  assert.equal(fs.existsSync(resultFile()), false, 'helper block not recorded while the outer Lead lives');
  stop(block('summary: outer'), 'outer');
  assert.match(result(SLUG).out, /summary: outer/);
});

test('a Lead start drops results of earlier Leads, also of other runs (stale result)', () => {
  reset();
  const other = `${ID}/03-other`;
  mkRun(other);
  start('old');
  stop(`STATUS: needs-ceo\nrun: .company/work/${other}\nform: f01`, 'old');
  assert.match(result().out, /needs-ceo/);
  start('new');
  assert.match(result().out, /result: none/, 'no slug: nothing of the earlier Lead');
  assert.match(result(other).out, /result: none/);
  stop(block(), 'new');
  assert.match(result().out, /STATUS: done/);
});

test('a result of an ended run from an earlier Lead is not returned for a new Lead', () => {
  reset();
  start('old');
  stop(block('summary: old'), 'old');
  endRun(SLUG);
  start('new');
  assert.match(result().out, /result: none/);
  assert.match(result(SLUG).out, /result: none/);
});

test('over 8 KiB of multi-byte text is cut by bytes at a character boundary and still readable', () => {
  reset();
  start();
  const lines = Array.from({ length: 30 }, (_, i) => `summary: ${i} ${'€—漢'.repeat(60)}`);
  stop(block(lines.join('\n')));
  assert.ok(fs.statSync(resultFile()).size <= 8192 + 1);
  const out = result(SLUG).out;
  assert.match(out, /^recorded: /);
  assert.doesNotMatch(out, /\uFFFD/);
  assert.match(out, /STATUS: done/);
});

test('at most 40 lines are kept', () => {
  reset();
  start();
  stop(block(Array.from({ length: 80 }, (_, i) => `summary: ${i}`).join('\n')));
  assert.ok(fs.readFileSync(resultFile(), 'utf8').trimEnd().split('\n').length <= 40);
});

test('bidi, zero-width and control characters are stripped when written and when shown', () => {
  reset();
  start();
  stop(block('summary: a\u202Eb\u200Bc\u0007d\u2066e'));
  const disk = fs.readFileSync(resultFile(), 'utf8');
  assert.match(disk, /summary: abcde/);
  // a forged file with such characters (written by anything) is cleaned on the read side too
  fs.writeFileSync(resultFile(), `STATUS: done\u200B\nrun: .company/work/${SLUG}\nsummary: x\u202Ey\u0000z\n`);
  const out = result(SLUG).out;
  assert.match(out, /summary: xyz/);
  assert.doesNotMatch(out, /[\u202E\u200B\u0000]/);
});

test('a forged file without a valid STATUS line reads as none', () => {
  reset();
  fs.writeFileSync(resultFile(), 'hello\nSTATUS: done\n');
  assert.match(result(SLUG).out, /result: none/);
});

test('a hard link or symlink planted at the old fixed tmp name or at the result name never gets written through', () => {
  reset();
  const victim = path.join(root, 'victim.txt');
  fs.writeFileSync(victim, 'KEEP');
  for (const name of ['lead-result.txt.tmp', 'lead-result.txt']) {
    fs.rmSync(path.join(dirOf(SLUG), name), { force: true });
    fs.linkSync(victim, path.join(dirOf(SLUG), name));
  }
  start();
  stop(block());
  assert.equal(fs.readFileSync(victim, 'utf8'), 'KEEP', 'hard link target untouched');
  assert.match(result(SLUG).out, /STATUS: done/);
  const sym = path.join(dirOf(SLUG), 'lead-result.txt');
  fs.rmSync(sym, { force: true });
  try { fs.symlinkSync(victim, sym); } catch { return; } // no symlink right on this host
  start();
  stop(block('summary: again'));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'KEEP', 'symlink target untouched');
});

test('result refuses a traversal or odd slug and a symlinked run folder gets nothing recorded', () => {
  reset();
  for (const s of ['../x', '..\\x', `${ID}/../02-lead`, `${ID.toLowerCase()}/02-lead`, 'x'.repeat(200)]) {
    const r = result(s);
    assert.equal(r.code, 1, s);
    assert.match(r.out, /refused: (bad slug|no run)/);
  }
  assert.equal(result('a', 'b').code, 1);
  const real = path.join(root, 'elsewhere');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'run-state.jsonl'), '{}\n');
  const linkSlug = `${ID}/04-link`;
  try { fs.symlinkSync(real, dirOf(linkSlug), 'junction'); } catch { return; }
  start();
  stop(block('summary: x', linkSlug));
  assert.equal(fs.existsSync(path.join(real, 'lead-result.txt')), false);
});

test('open and again refuse an ended run', () => {
  reset();
  const ended = `${ID}/05-ended`;
  mkRun(ended);
  endRun(ended);
  const q = path.join(root, 'q.json');
  fs.writeFileSync(q, JSON.stringify([{ q: 'Go?', header: 'Go', multi: false, options: [{ label: 'Yes', description: 'y' }, { label: 'No', description: 'n' }] }]));
  const r = main(['open', ended, 'ask', 'q.json'], root);
  assert.equal(r.code, 1);
  assert.match(r.out, /refused: run ended/);
  assert.equal(fs.existsSync(path.join(dirOf(ended), 'forms.jsonl')), false);
});

// ---- shield: a Role cannot write lead-result.txt, nor run the record functions from a shell ----------------------------
const rec = (cmd, tool = 'Bash') => ({ tool: { name: tool, command: cmd, paths: [] }, protected: [] });
const protectedPath = (p) => ({ tool: { name: 'Write', paths: [{ raw: p, expanded: p, real: p }] }, protected: [p.replace(/\\/g, '/').toLowerCase()] });

test('self-protect denies a file tool and a shell write that name lead-result.txt', () => {
  const file = 'C:/proj/.company/work/P20261119.000009/02-lead/lead-result.txt';
  assert.equal(judgeRecord(protectedPath(file)).v, 'deny');
  for (const cmd of [`echo x > ${file}`, `node -e "require('fs').writeFileSync('${file}','x')"`, `cp evil ${file}`]) assert.equal(judgeRecord(rec(cmd)).v, 'deny', cmd);
  assert.equal(judge(rec(`cat ${file}`)).v, 'allow');
});

test('self-protect denies a shell that runs the lead-relay record functions', () => {
  for (const cmd of [`node -e "import('./scripts/lead-relay.mjs').then(m=>m.leadStop('x'))"`, `node -e "import('./scripts/lead-relay.mjs').then(m=>m.leadStart('x'))"`]) {
    assert.equal(judgeRecord(rec(cmd)).v, 'deny', cmd);
  }
  assert.equal(judgeRecord(rec('node scripts/lead-relay.mjs result')).v, 'allow');
});

// ---- host: the record is written when the stop is allowed, not when cap.M1 blocks it ---------------------------------------
test('host: an allowed Lead stop is recorded, a blocked one is not until the stop that ends', async () => {
  const fx = await capEnv();
  fx.boot();
  const slug = fx.slug;
  const msg = `STATUS: handover\nrun: .company/work/${slug}\nhandoff: 01-x.md\nnext: resume`;
  const lead = (name, over = {}) => fx.env.event(name, { agent_id: 'lead-h1', agent_type: LEAD_TYPE, ...over });
  const resultOf = () => path.join(fx.runDir, 'lead-result.txt');
  const read = () => spawnSync(process.execPath, [SCRIPT, 'result', slug], { cwd: fx.env.project, encoding: 'utf8', timeout: 20000 }).stdout;

  assert.equal(fx.env.run(lead('SubagentStart')).code, 0);
  assert.equal(fx.env.run(lead('SubagentStop', { last_assistant_message: msg })).code, 0);
  assert.match(read(), /STATUS: handover/, 'allowed stop recorded');

  fs.rmSync(resultOf(), { force: true });
  fx.env.run(lead('SubagentStart', { agent_id: 'lead-h2' }));
  // a host-side deny (here: an unreadable rule table) blocks the stop, so the Lead keeps going
  fs.writeFileSync(path.join(fx.env.plugin, 'hooks', 'rules.json'), 'not json');
  fx.env.repin();
  const blocked = fx.env.run(lead('SubagentStop', { agent_id: 'lead-h2', last_assistant_message: msg, stop_hook_active: false }));
  assert.equal(blocked.json?.decision, 'block', 'precondition: the host blocks this stop');
  assert.equal(fs.existsSync(resultOf()), false, 'a blocked stop records nothing');
  fx.env.run(lead('SubagentStop', { agent_id: 'lead-h2', last_assistant_message: msg, stop_hook_active: true }));
  assert.match(read(), /STATUS: handover/, 'the stop that ends is recorded');
});
