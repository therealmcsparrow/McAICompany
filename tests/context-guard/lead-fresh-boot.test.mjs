// A fresh Lead session holds about 55k tokens before it reads anything (system prompt, tools, skill and agent listings),
// and the context-guard `lead` branch freezes at the handover of the run's cap (162000 by default). The boot path (new-session command, resume line,
// header) must therefore point to the short skills/pipeline/references/lead-resume.md, and what that path loads must stay
// small enough to leave real headroom below the point.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pre } from '../../scripts/context-guard.mjs';
import { newSessionCommand, HEADER, resume } from '../../scripts/lead-handover.mjs';
import { append } from '../../scripts/run-state.mjs';

const SLUG = '2026-11-03 07.12 - Lead Fresh Session Test';
const SESSION = 'sess-fresh-lead-1';
const NOW = Math.floor(Date.now() / 1000) * 1000;
const usage = (n) => ({ input_tokens: 2, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: n - 3202 });
const row = (n) => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: usage(n) } })}\n`;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// A run with a Lead transcript holding the given main-chain readings in order (first = session start).
// `cap` is the cap recorded on the run's start line; absent records none.
function fixture(readings, cap) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-fresh-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  if (cap === undefined) append(root, SLUG, { ev: 'start' }, { now: NOW - 60000 });
  else fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: new Date(NOW - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), ev: 'start', cap })}
`);
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, 'lead.jsonl');
  fs.writeFileSync(transcript, readings.map(row).join(''));
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: SESSION, tool_name: 'Bash', tool_input: {} });
  const record = () => {
    const f = path.join(dir, 'lead-handover.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { input, opts: { root, claudeDir, env: {}, now: NOW }, record };
}

const repo = path.join(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8');

const BASELINE = 55600;      // measured first reading of a fresh Lead session
const BYTES_PER_TOKEN = 3;   // conservative: real text is nearer 4
const BOOT_HEADROOM_AT = 71000;

describe('Lead hand-over loop: lean boot path', () => {
  test('what the resume path loads (resume file plus pipeline skill) keeps the boot reading near 71k', () => {
    const bytes = ['skills/pipeline/references/lead-resume.md', 'skills/pipeline/SKILL.md']
      .reduce((n, f) => n + Buffer.byteLength(read(...f.split('/'))), 0);
    const tokens = BASELINE + Math.ceil(bytes / BYTES_PER_TOKEN);
    assert.ok(tokens <= BOOT_HEADROOM_AT, `boot reading ${tokens} must stay at or below ${BOOT_HEADROOM_AT} (${bytes} bytes loaded)`);
  });

  test('the resume file tells the Lead not to load the Playbook skill or the full reference', () => {
    const t = read('skills', 'pipeline', 'references', 'lead-resume.md');
    assert.match(t, /## Do not load at boot/);
    assert.match(t, /Playbook skill/);
  });

  test('the new-session command names the resume file, not the full reference', () => {
    const c = newSessionCommand(SLUG);
    assert.match(c, /references\/lead-resume\.md/);
    assert.ok(!c.includes('lead-handover.md'));
  });

  test('HEADER names the resume file, not the full reference', () => {
    assert.match(HEADER, /skills\/pipeline\/references\/lead-resume\.md/);
    assert.ok(!HEADER.includes('lead-handover.md'));
  });

  test('resume() output after a compact names the resume file', () => {
    const f = fixture([55558]);
    const payload = JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: SESSION });
    const r = resume(payload, { root: f.opts.root, now: NOW });
    const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
    assert.match(ctx, /references\/lead-resume\.md/);
    assert.ok(!ctx.includes('lead-handover.md'));
  });
});

describe('Lead hand-over loop: the guard still freezes a session over the point', () => {
  test('control: a session far over the run handover (55558 -> 150000, cap 120000) is still frozen', () => {
    const f = fixture([55558, 100000, 150000], 120000);
    const r = pre(f.input, f.opts);
    assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(f.record().filter((e) => e.ev === 'handover').length, 1);
  });

  test('a fresh session below the run handover is not frozen: 108000 at cap 130000 is allowed, 117000 is frozen', () => {
    const low = fixture([55558, 100000, 108000], 130000);
    assert.deepEqual(pre(low.input, low.opts), { code: 0, out: '', err: '' });
    assert.deepEqual(low.record(), []);
    const hi = fixture([55558, 100000, 117000], 130000);
    assert.equal(JSON.parse(pre(hi.input, hi.opts).out).hookSpecificOutput.permissionDecision, 'deny');
  });

  test('without a recorded cap the same session freezes at 162000, not at 150000', () => {
    const low = fixture([55558, 100000, 150000]);
    assert.deepEqual(pre(low.input, low.opts), { code: 0, out: '', err: '' });
    const hi = fixture([55558, 100000, 162000]);
    assert.equal(JSON.parse(pre(hi.input, hi.opts).out).hookSpecificOutput.permissionDecision, 'deny');
  });

  test('the smallest cap hands over below a fresh session reading: a boot at 55558 with cap 60000 is frozen', () => {
    const f = fixture([55558], 60000);
    assert.equal(JSON.parse(pre(f.input, f.opts).out).hookSpecificOutput.permissionDecision, 'deny');
  });
});
