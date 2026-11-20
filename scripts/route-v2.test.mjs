// route v2.0: `security` skippable below high on `security_changed: false`, the one allowed `role-when` entry for a
// protected Role, and the new `owed` command (plan task T16, tests T11). Red until T16 (and T17) land.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const PROTECTED = ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'];
const SLUG = 'P20261116.000003/01-feature';
const BASE40 = 'a'.repeat(40);
const AGENTS = ['qa', 'security', 'architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'vuln-scanner',
  'product-manager', 'backend-engineer', 'senior-engineer', 'accessibility-tester', 'ui-ux-designer', 'localizer'];
const WHEN = { 'accessibility-tester': ['ui_changed'], 'ui-ux-designer': ['ui_changed'], localizer: ['strings_changed', 'languages>1'] };
const WHEN_SEC = { ...WHEN, security: ['security_changed'] };

const sandboxes = [];
after(() => { for (const r of sandboxes) fs.rmSync(r, { recursive: true, force: true }); });

// A fake plugin root holds a copy of every non-test script (so the script's own folder decides where company/ and
// agents/ are read) and mods/lib; the product root is cwd.
function sandbox({ when = WHEN_SEC } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routev2-'));
  const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'routev2-plugin-'));
  sandboxes.push(root, plugin);
  fs.mkdirSync(path.join(plugin, 'scripts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'scripts'))) {
    if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(plugin, 'scripts', f));
  }
  fs.cpSync(path.join(REPO, 'mods', 'lib'), path.join(plugin, 'mods', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'company'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'agents'), { recursive: true });
  for (const a of AGENTS) fs.writeFileSync(path.join(plugin, 'agents', `${a}.md`), `---\nname: ${a}\n---\n`);
  fs.writeFileSync(path.join(plugin, 'company', 'model-floor.json'), JSON.stringify({ v: 1, protected: PROTECTED }));
  fs.writeFileSync(path.join(plugin, 'company', 'step-budgets.json'), JSON.stringify({ v: 1, budgets: { feature: 10, fix: 6 }, source: 'test fixture' }));
  fs.writeFileSync(path.join(plugin, 'company', 'role-when.json'), JSON.stringify({ v: 1, when }));
  fs.mkdirSync(path.join(root, '.company'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project\nlanguages: en\n');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const run = path.join(root, '.company', 'work', ...SLUG.split('/'));
  fs.mkdirSync(run, { recursive: true });
  return { root, plugin, home, run };
}

function cli(sb, args) {
  const r = spawnSync(process.execPath, [path.join(sb.plugin, 'scripts', 'route.mjs'), ...args], {
    cwd: sb.root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home, MCSPARROW_HOME: path.join(sb.home, '.mcsparrow'), AICO_COLD: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const step = (role, why = 'planned') => ({ role, why });
function writeRoute(sb, roles = ['qa', 'security']) {
  const d = { playbook: 'feature', size: 'M', steps: roles.map((r) => step(r)), skips: [] };
  const p = path.join(sb.root, 'draft.json');
  fs.writeFileSync(p, JSON.stringify(d));
  const w = cli(sb, ['write', SLUG, p]);
  assert.equal(w.code, 0, `write failed: ${w.out}${w.err}`);
}

// A tier-path record: begin at `tier` on the full path, then optional raises.
const AT = '2026-11-20T10:00:00Z';
function tierRecord(sb, tier, raises = []) {
  const begin = { v: 1, at: AT, ev: 'begin', pb: 'feature', tier, path: 'full', why: 'tier', rev: 2, base: BASE40, skip: [] };
  const lines = [begin, ...raises.map((t) => ({ v: 1, at: AT, ev: 'raise', tier: t, cause: 'ceo' }))];
  fs.writeFileSync(path.join(sb.run, 'tier-path.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
}

function facts(sb, flags = {}, name = '05-backend-engineer') {
  const f = {
    v: 1, step: name, base: BASE40, head: 'b'.repeat(40),
    paths: [{ path: 'p0.code', from: null, status: 'M', kind: 'code' }],
    truncated: false, ui_changed: false, strings_changed: false, contract_changed: false, docs_only: false,
    security_changed: false,
    ...flags,
  };
  fs.mkdirSync(path.join(sb.run, 'facts'), { recursive: true });
  fs.writeFileSync(path.join(sb.run, 'facts', `${name}.json`), JSON.stringify(f));
}

// Run `next` once per route entry and return the decision for the last entry (`security`).
function decideSecurity(sb) {
  let last;
  for (let i = 0; i < 2; i++) {
    const r = cli(sb, ['next', SLUG]);
    assert.equal(r.code, 0, `next failed: ${r.out}${r.err}`);
    last = JSON.parse(r.out.trim().split('\n').pop());
  }
  assert.equal(last.role, 'security');
  return last;
}

async function lint(sb) {
  const { lintData } = await import(`${pathToFileURL(path.join(sb.plugin, 'scripts', 'route.mjs')).href}?v=${Math.random()}`);
  return lintData(sb.plugin, PROTECTED);
}

// Control: the v2 skip works, so a "run" answer in the tests below means the guard held, not that skipping is absent.
function control() {
  const sb = sandbox();
  writeRoute(sb);
  tierRecord(sb, 'medium');
  facts(sb, { security_changed: false });
  assert.equal(decideSecurity(sb).do, 'skip', 'control: medium + security_changed false must skip');
}

describe('role-when: the one allowed entry for a protected Role', () => {
  test('security: ["security_changed"] is accepted; no lint error', async () => {
    const errors = await lint(sandbox({ when: WHEN_SEC }));
    assert.deepEqual(errors, []);
  });
  test('an entry for architect is a lint error', async () => {
    assert.deepEqual(await lint(sandbox({ when: WHEN_SEC })), []);
    const errors = await lint(sandbox({ when: { ...WHEN_SEC, architect: ['ui_changed'] } }));
    assert.ok(errors.some((e) => /architect/.test(e)), errors.join('\n'));
  });
  test('security with any condition other than security_changed is a lint error', async () => {
    assert.deepEqual(await lint(sandbox({ when: WHEN_SEC })), []);
    const errors = await lint(sandbox({ when: { ...WHEN, security: ['ui_changed'] } }));
    assert.ok(errors.some((e) => /security/.test(e)), errors.join('\n'));
  });
  test('other protected Roles stay refused (code-reviewer, fresh-reviewer)', async () => {
    assert.deepEqual(await lint(sandbox({ when: WHEN_SEC })), []);
    for (const r of ['code-reviewer', 'fresh-reviewer']) {
      const errors = await lint(sandbox({ when: { ...WHEN_SEC, [r]: ['security_changed'] } }));
      assert.ok(errors.some((e) => e.includes(r)), `${r}: ${errors.join('\n')}`);
    }
  });
});

describe('next: security below high', () => {
  test('medium tier + security_changed false -> skip security with a why', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false });
    const d = decideSecurity(sb);
    assert.equal(d.do, 'skip');
    assert.match(d.why, /security_changed/);
    assert.ok(d.why.length > 0);
  });
  test('low tier + security_changed false -> skip', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'low');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'skip');
  });
  test('medium tier + security_changed true -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: true });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('high tier + security_changed false -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'high');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('medium start raised to high before the Step -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium', ['high']);
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('no tier record -> run (unreadable tier counts as high)', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('broken tier record -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    fs.writeFileSync(path.join(sb.run, 'tier-path.jsonl'), '{not json\n');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('missing facts -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('facts file without the security_changed key -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: undefined });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('facts with an unknown path kind -> run', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false, paths: [{ path: 'p0.xyz', from: null, status: 'M', kind: 'unknown' }] });
    assert.equal(decideSecurity(sb).do, 'run');
  });
  test('a protected Role other than security is never skipped, even with a flag false', () => {
    control();
    const sb = sandbox();
    writeRoute(sb, ['code-reviewer', 'security']);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false, ui_changed: false });
    const first = JSON.parse(cli(sb, ['next', SLUG]).out.trim());
    assert.equal(first.role, 'code-reviewer');
    assert.equal(first.do, 'run');
  });
});

describe('owed: a skipped security Step that a later raise makes due', () => {
  test('skip, then raise to high -> `owed: security`', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'skip');
    tierRecord(sb, 'medium', ['high']);
    const r = cli(sb, ['owed', SLUG]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /owed: security/);
  });
  test('skip, then newer facts with security_changed true -> `owed: security`', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false }, '05-backend-engineer');
    assert.equal(decideSecurity(sb).do, 'skip');
    facts(sb, { security_changed: true }, '06-backend-engineer');
    assert.match(cli(sb, ['owed', SLUG]).out, /owed: security/);
  });
  test('skip and nothing changed -> nothing owed', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'skip');
    const r = cli(sb, ['owed', SLUG]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /owed: security/);
  });
  test('a run that ran security (high) owes nothing', () => {
    control();
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'high');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'run');
    assert.doesNotMatch(cli(sb, ['owed', SLUG]).out, /owed: security/);
  });
  test('a `fix` event for security clears the debt', () => {
    const sb = sandbox();
    writeRoute(sb);
    tierRecord(sb, 'medium');
    facts(sb, { security_changed: false });
    assert.equal(decideSecurity(sb).do, 'skip');
    tierRecord(sb, 'medium', ['high']);
    assert.match(cli(sb, ['owed', SLUG]).out, /owed: security/);
    const fx = cli(sb, ['fix', SLUG, 'security', 'late security pass']);
    assert.equal(fx.code, 0, fx.out + fx.err);
    const r = cli(sb, ['owed', SLUG]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /owed: security/);
  });
  test('owed refuses a bad slug and a missing route', () => {
    const sb = sandbox();
    assert.notEqual(cli(sb, ['owed', '../x']).code, 0);
    assert.notEqual(cli(sb, ['owed', SLUG]).code, 0);
    writeRoute(sb);
    assert.equal(cli(sb, ['owed', SLUG]).code, 0, 'control: owed answers on a written route');
  });
});
