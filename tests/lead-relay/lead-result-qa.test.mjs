// QA-owned black-box contract tests for lead-relay v1.1 (task P20261119.000001/01-fix, round 2, closes R-7): the Lead result record
// (`lead-result.txt`, written by the hook host on SubagentStart/SubagentStop/PreToolUse) and the CLI word `result`, plus the
// `run ended` refusal of `open` and `again`. Everything runs through the real hook host (spawned) and the real lead-relay CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { capEnv, cleanup, LEAD_TYPE, REPO } from '../context-guard/cap-engine.mjs';

const CLI = path.join(REPO, 'scripts', 'lead-relay.mjs');
const RS = path.join(REPO, 'scripts', 'run-state.mjs');
after(() => cleanup());

// Bidi, zero-width, control, separator and tag characters a result must never show.
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/u;
const HOSTILE = '\u202eevil\u202c \u200bzero\u2066iso\u2069 \u0007bell \u001b[31mred\u0085nel \u2028ls\u2029ps \u{e0041}tag \ufeffbom';

async function setup() {
  const fx = await capEnv();
  const slug = fx.slug;
  const dir = fx.runDir;
  const file = path.join(dir, 'lead-result.txt');
  const envOf = () => ({ ...process.env, MCSPARROW_HOME: fx.env.home });
  const lead = (name, over = {}) => fx.env.event(name, { agent_id: 'qa-lead-1', agent_type: LEAD_TYPE, ...over });
  const start = (id = 'qa-lead-1') => fx.env.run(lead('SubagentStart', { agent_id: id }));
  const stop = (msg, id = 'qa-lead-1', over = {}) => fx.env.run(lead('SubagentStop', { agent_id: id, last_assistant_message: msg, ...over }));
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: fx.env.project, encoding: 'utf8', timeout: 20000, env: envOf() });
  const block = (extra = 'summary: ok', s = slug) => `STATUS: done\nrun: .company/work/${s}\n${extra}`;
  const spawnLead = () => fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: LEAD_TYPE, description: 'd', prompt: 'p' }, tool_use_id: 'qa-t1' }));
  const endRun = (s) => {
    const r = spawnSync(process.execPath, [RS, 'end', s, 'ship'], { cwd: fx.env.project, encoding: 'utf8', env: envOf() });
    const st = spawnSync(process.execPath, [RS, 'show', s, '--json'], { cwd: fx.env.project, encoding: 'utf8', env: envOf() });
    assert.match(st.stdout, /ended/, `precondition: run ended\n${r.stdout}${r.stderr}${st.stdout}`);
  };
  return { fx, slug, dir, file, lead, start, stop, cli, block, spawnLead, endRun };
}

test('result is none before any Lead stop (with and without slug)', async () => {
  const t = await setup();
  for (const args of [[t.slug], []]) {
    const r = t.cli('result', ...args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^result: none\s*$/);
  }
  t.start(); // a started Lead has not stopped yet
  assert.match(t.cli('result', t.slug).stdout, /result: none/);
});

test('a recorded final block is returned by result, with and without slug', async () => {
  const t = await setup();
  t.start();
  assert.equal(t.stop(t.block('summary: first\nsummary: second')).code, 0);
  for (const args of [[t.slug], []]) {
    const r = t.cli('result', ...args);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.match(lines[0], /^recorded: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(lines.slice(1, 5), ['STATUS: done', `run: .company/work/${t.slug}`, 'summary: first', 'summary: second']);
  }
});

test('a stale result of an earlier Lead is not returned once a new Lead starts', async () => {
  const t = await setup();
  t.start('old');
  t.stop(t.block('summary: old'), 'old');
  assert.match(t.cli('result', t.slug).stdout, /summary: old/, 'precondition');
  t.start('new');
  assert.match(t.cli('result', t.slug).stdout, /result: none/);
  assert.match(t.cli('result').stdout, /result: none/);
  assert.equal(fs.existsSync(t.file), false);
});

test('a helper Lead (second live Lead) records nothing; the outer Lead stop does', async () => {
  const t = await setup();
  t.start('outer');
  t.start('helper');
  t.stop(t.block('summary: helper'), 'helper');
  assert.match(t.cli('result', t.slug).stdout, /result: none/);
  t.stop(t.block('summary: outer'), 'outer');
  const out = t.cli('result', t.slug).stdout;
  assert.match(out, /summary: outer/);
  assert.doesNotMatch(out, /summary: helper/);
});

test('multibyte block over 8 KiB is capped by bytes, not characters, at a UTF-8 boundary', async () => {
  const t = await setup();
  t.start();
  const body = '\u20ac'.repeat(4000); // 3 bytes each: 12000 bytes, 4000 chars
  t.stop(t.block(`summary: ${body}`));
  const out = t.cli('result', t.slug).stdout;
  const rest = out.slice(out.indexOf('\n') + 1);
  assert.match(rest, /^STATUS: done/);
  assert.ok(Buffer.byteLength(rest.replace(/\n$/, '')) <= 8192, `payload bytes ${Buffer.byteLength(rest)}`);
  assert.ok(rest.length < 4000, 'cut by bytes: a 4000-char tail would mean chars were counted');
  assert.ok(rest.includes('\u20ac'), 'some of the text kept');
  assert.equal(rest.includes('\ufffd'), false, 'no split sequence');
  assert.ok(fs.readFileSync(t.file).length <= 8192 + 64, 'record on disk is capped too');
});

test('at most 40 lines are shown', async () => {
  const t = await setup();
  t.start();
  const many = Array.from({ length: 80 }, (_, i) => `summary: line${i}`).join('\n');
  t.stop(t.block(many));
  const out = t.cli('result', t.slug).stdout.replace(/\n$/, '').split('\n');
  assert.ok(out.length - 1 <= 40, `${out.length - 1} block lines`);
  assert.equal(out.includes('summary: line79'), false);
});

test('bidi, zero-width, control, separator and tag characters never appear in result output (host-recorded)', async () => {
  const t = await setup();
  t.start();
  t.stop(t.block(`summary: ${HOSTILE}`));
  const out = t.cli('result', t.slug).stdout;
  assert.match(out, /^recorded: /);
  assert.match(out, /summary: /);
  assert.doesNotMatch(out, BAD);
  assert.doesNotMatch(t.cli('result').stdout, BAD);
});

test('result sanitises a file that holds hostile characters (defence on read); no valid line 1 is none', async () => {
  const t = await setup();
  fs.writeFileSync(t.file, `STATUS: done\nrun: .company/work/${t.slug}\nsummary: ${HOSTILE}\n`);
  const out = t.cli('result', t.slug).stdout;
  assert.doesNotMatch(out, BAD);
  assert.match(out, /STATUS: done/);
  for (const bad of ['STATUS: bogus\nrun: x\n', 'hello\nSTATUS: done\n', '\nSTATUS: done\n']) {
    fs.writeFileSync(t.file, bad);
    assert.match(t.cli('result', t.slug).stdout, /result: none/, JSON.stringify(bad));
  }
  // a bidi mark before line 1 is stripped for display; whatever is shown carries no such character
  fs.writeFileSync(t.file, '‮STATUS: done\n');
  assert.doesNotMatch(t.cli('result', t.slug).stdout, BAD);
});

test('a hard link planted at the record name is not written through', async () => {
  const t = await setup();
  const outside = path.join(t.fx.env.base, 'outside-hard.txt');
  fs.writeFileSync(outside, 'ORIGINAL\n');
  fs.linkSync(outside, t.file);
  t.start();
  t.stop(t.block('summary: after link'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL\n', 'the link target was not written');
  assert.match(t.cli('result', t.slug).stdout, /summary: after link/);
  // planted between start and stop: the rename must replace the link, never write through it
  t.start('l2');
  fs.rmSync(t.file, { force: true });
  fs.linkSync(outside, t.file);
  t.stop(t.block('summary: second'), 'l2');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL\n', 'target untouched after a link planted between start and stop');
});

test('a symlink planted at the record name is not followed (write or read)', async (ctx) => {
  const t = await setup();
  const outside = path.join(t.fx.env.base, 'outside-sym.txt');
  const leak = `STATUS: done\nrun: .company/work/${t.slug}\nsummary: LEAKED\n`;
  fs.writeFileSync(outside, leak);
  try { fs.symlinkSync(outside, t.file); } catch (e) { return ctx.skip(`symlink not permitted: ${e.code}`); }
  assert.doesNotMatch(t.cli('result', t.slug).stdout, /LEAKED/, 'result followed a symlink');
  t.start('s1');
  fs.rmSync(t.file, { force: true });
  fs.symlinkSync(outside, t.file);
  t.stop(t.block('summary: fresh'), 's1');
  assert.equal(fs.readFileSync(outside, 'utf8'), leak, 'the symlink target was not overwritten');
  assert.doesNotMatch(t.cli('result', t.slug).stdout, /LEAKED/);
});

test('a linked run folder is not recorded into', async (ctx) => {
  const t = await setup();
  const real = path.join(t.fx.env.base, 'elsewhere');
  fs.mkdirSync(real, { recursive: true });
  fs.copyFileSync(path.join(t.dir, 'run-state.jsonl'), path.join(real, 'run-state.jsonl'));
  const s2 = 'P20261114.000099/09-linked';
  fs.mkdirSync(path.join(t.fx.env.project, '.company', 'work', 'P20261114.000099'), { recursive: true });
  try { fs.symlinkSync(real, path.join(t.fx.env.project, '.company', 'work', ...s2.split('/')), 'junction'); } catch (e) { return ctx.skip(`link not permitted: ${e.code}`); }
  t.start();
  t.stop(t.block('summary: via link', s2));
  assert.equal(fs.existsSync(path.join(real, 'lead-result.txt')), false);
});

test('a traversal or malformed slug is refused by result', async () => {
  const t = await setup();
  for (const bad of ['../x', '../../etc', 'P20261114.000099/../../x', '/abs', 'P20261114.000099/01-feature/..', 'a\u202eb']) {
    const r = t.cli('result', bad);
    assert.notEqual(r.status, 0, `slug ${JSON.stringify(bad)} accepted: ${r.stdout}`);
    assert.match(r.stdout + r.stderr, /refused:|usage/, JSON.stringify(bad));
  }
  const unknown = t.cli('result', 'P20261114.000098/01-none');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout + unknown.stderr, /refused: no run/);
});

test('open and again on an ended run are accepted for a form opened at or after the end', async () => {
  const t = await setup();
  const q = path.join(t.fx.env.project, 'qa-q.json');
  fs.writeFileSync(q, JSON.stringify([{ q: 'Go on?', header: 'Ask', multi: false, options: [{ label: 'Yes', description: 'Go' }, { label: 'No', description: 'Stop' }] }]));
  t.endRun(t.slug);
  const o = t.cli('open', t.slug, 'ask', 'qa-q.json');
  assert.equal(o.status, 0, o.stdout + o.stderr);
  const again = t.cli('again', t.slug, 'f01');
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /STATUS: needs-ceo/);
});

test('a stale live-set entry is reset when main spawns a Lead, so the next Lead is recorded', async () => {
  const t = await setup();
  t.start('dead'); // never stops
  t.start('also-dead');
  const sp = t.spawnLead();
  assert.notEqual(sp.json?.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(sp.json));
  t.start('fresh');
  t.stop(t.block('summary: fresh'), 'fresh');
  assert.match(t.cli('result', t.slug).stdout, /summary: fresh/);
});

test('without a main spawn a dead Lead entry still counts as live (precondition of the reset test)', async () => {
  const t = await setup();
  t.start('dead');
  t.start('fresh');
  t.stop(t.block('summary: muted'), 'fresh');
  assert.match(t.cli('result', t.slug).stdout, /result: none/);
});
