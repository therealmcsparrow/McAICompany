// Tests (qa-owned): the shipped hooks/rules.json, the real rule modules and the shipped fixtures, run through
// the real engine path (scripts/hook-host.mjs, real plugin root). MCSPARROW_HOME points at a temp dir.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = path.join(ROOT, 'scripts', 'hook-host.mjs');
const FIXTURES = path.join(ROOT, 'hooks', 'fixtures');
const SKIP_DIRS = new Set(['engine']);

let tmp;
let home;
let project;
const fwd = (p) => p.replace(/\\/g, '/');

function host(payload) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, MCSPARROW_HOME: home, HOME: tmp, USERPROFILE: tmp };
  delete env.AICO_GUARDS;
  const r = spawnSync(process.execPath, [HOST], {
    input: JSON.stringify(payload),
    cwd: project,
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
    env
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* left null */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

const denyReason = (r) => (r.json?.hookSpecificOutput?.permissionDecision === 'deny' ? r.json.hookSpecificOutput.permissionDecisionReason : null);
const base = (over) => ({ hook_event_name: 'PreToolUse', session_id: 'fixture', transcript_path: 'fixture.jsonl', cwd: fwd(project), permission_mode: 'default', ...over });

// Fixture paths under /proj are moved into the temp project so they resolve against the same root.
const localize = (v) => {
  if (typeof v === 'string') return v === '/proj' || v.startsWith('/proj/') ? fwd(project) + v.slice('/proj'.length) : v;
  if (Array.isArray(v)) return v.map(localize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x)]));
  return v;
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-shipped-'));
  home = path.join(tmp, 'mcsparrow');
  project = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'README.md'), '# demo\n');
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe('shipped rule table through the real engine', () => {
  test('session start: the fixture check passes and no drift is reported', () => {
    const r = host(base({ hook_event_name: 'SessionStart', source: 'startup' }));
    assert.equal(r.code, 0, r.err);
    const msg = typeof r.json?.systemMessage === 'string' ? r.json.systemMessage : '';
    assert.doesNotMatch(msg, /fixture check failed/, msg);
    assert.doesNotMatch(msg, /hook payload changed|pins-mismatch/, msg);
    const lead = fs.readdirSync(home, { recursive: true }).map(String).filter((n) => /lead.*\.json$/.test(n));
    assert.ok(lead.length > 0, 'no Lead snapshot written');
    for (const n of lead) assert.notEqual(JSON.parse(fs.readFileSync(path.join(home, n), 'utf8')).drift, true, `drift in ${n}`);
  });

  test('a plain Read of README.md is allowed', () => {
    const r = host(base({ tool_name: 'Read', tool_input: { file_path: 'README.md' } }));
    assert.equal(r.code, 0, r.err);
    assert.equal(denyReason(r), null, `denied: ${denyReason(r)}`);
  });

  test('a Grep is allowed', () => {
    const r = host(base({ tool_name: 'Grep', tool_input: { pattern: 'demo', path: '.' } }));
    assert.equal(r.code, 0, r.err);
    assert.equal(denyReason(r), null, `denied: ${denyReason(r)}`);
  });

  const dirs = fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name)).map((d) => d.name).sort();
  for (const dir of dirs) {
    const names = fs.readdirSync(path.join(FIXTURES, dir)).filter((n) => /^(pass|block)-.+\.json$/.test(n)).sort();
    for (const n of names) {
      const wantDeny = n.startsWith('block-');
      test(`${dir}/${n} ${wantDeny ? 'denies' : 'passes'}`, () => {
        const payload = localize(JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, n), 'utf8')));
        const r = host(payload);
        assert.equal(r.code, 0, r.err);
        const reason = denyReason(r);
        if (wantDeny) { assert.ok(reason, `expected a deny, got ${r.out}`); assert.ok(reason.startsWith(`aico guard ${dir}:`), `denied by another rule: ${reason}`); }
        else assert.equal(reason, null, `unexpected deny: ${reason}`);
      });
    }
  }
});
