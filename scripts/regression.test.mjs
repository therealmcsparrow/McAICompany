// Quality floor (AC26): 5 seeds that must stay caught by the new machinery (rule-check, check.mjs, settings).
// Seeds 1-3 are the lines of .company/lessons.md, seeds 4-5 the fix commits bddd366 and 052a035.
// Fixtures live in tests/regression/ or temp dirs; the real repo and the real home are never written (proj.M8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check } from './check.mjs';
import { resolveSettings } from './settings.mjs';

const realRoot = path.join(import.meta.dirname, '..');
const fixtures = path.join(realRoot, 'tests', 'regression');
const ruleCheck = path.join(import.meta.dirname, 'rule-check.mjs');

const made = [];
function tmp(name = 'regression-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function cleanEnv(home) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, MCSPARROW_HOME: path.join(home, 'mh'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'none') };
  delete e.NODE_TEST_CONTEXT;
  return e;
}
function ruleCheckCli(root, args) {
  const r = spawnSync(process.execPath, [ruleCheck, ...args, '--root', root], { cwd: root, encoding: 'utf8', env: cleanEnv(tmp('regression-home-')) });
  return { status: r.status, out: r.stdout, all: r.stdout + r.stderr };
}
function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv(tmp('regression-home-'))
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// ---------- seed 1: a fix round that rewrites a line keeps every rule the line carried ----------

function skillRoot(fixture) {
  const root = tmp();
  write(root, 'skills/demo/SKILL.md', fs.readFileSync(path.join(fixtures, fixture), 'utf8'));
  return root;
}

test('seed 1 lessons: a rewritten dispatch line that dropped Language: is caught by check.mjs', () => {
  assert.deepEqual(check(skillRoot('dispatch-ok.md')).errors, []);
  const { errors } = check(skillRoot('dispatch-no-language.md'));
  assert.ok(errors.some((e) => /dispatch block has Company profile: but no Language:/.test(e)), errors.join('\n'));
});

test('seed 1 lessons: a rewritten ruleset line that dropped a clause is caught by rule-check drift', () => {
  const original = 'Agent files stay short and every rule keeps its source';
  const rewritten = 'Agent files stay short';
  const standards = (text) => `library: ~/lib\nsigned-off: 2026-10-26 (architect)\n## Project rules\n- proj.M5 — ${text} — source: https://x.test — check: aico-check\n## Exceptions\n## Debt\n`;
  const checks = { version: 1, checks: { 'aico-check': { rule: 'proj.M5', text: sha(original) } } };
  const ok = tmp();
  write(ok, '.company/standards.md', standards(original));
  write(ok, '.company/checks.json', JSON.stringify(checks));
  assert.equal(ruleCheckCli(ok, ['drift']).status, 0);
  const bad = tmp();
  write(bad, '.company/standards.md', standards(rewritten));
  write(bad, '.company/checks.json', JSON.stringify(checks));
  const r = ruleCheckCli(bad, ['drift']);
  assert.equal(r.status, 1, r.all);
  assert.match(r.out, /proj\.M5 text changed/);
});

// ---------- seed 2: files are LF only ----------

test('seed 2 lessons: a CRLF text file in a change is caught by rule-check lf, with its line', () => {
  const root = tmp();
  const lfRule = 'Every text file is LF only';
  write(root, '.company/standards.md', `library: ~/lib\nsigned-off: 2026-10-26 (architect)\n## Project rules\n- proj.M11 — ${lfRule} — source: https://x.test — check: lf\n## Exceptions\n## Debt\n`);
  write(root, '.company/checks.json', JSON.stringify({ version: 1, checks: { lf: { rule: 'proj.M11', text: sha(lfRule) } } }));
  write(root, '.gitattributes', '* text=auto eol=lf\n');
  write(root, 'seed.txt', 'seed\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  write(root, 'run.mjs', '#!/usr/bin/env node\r\nconsole.log(1);\r\n'); // CR bytes come from escapes, never stored (proj.M11)
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'change');
  const r = ruleCheckCli(root, ['run', '--base', base]);
  const rows = r.out.split('\n').filter((l) => l.startsWith('T-'));
  assert.equal(rows.length, 1, r.all);
  assert.match(rows[0], /^T-1 \| run\.mjs:1 \| CR byte in text file \| proj\.M11: /);
});

test('seed 2 lessons: the repo keeps .gitattributes eol=lf and the regression files hold no CR byte', () => {
  const attrs = fs.readFileSync(path.join(realRoot, '.gitattributes'), 'utf8').split('\n');
  assert.ok(attrs.includes('* text=auto eol=lf'));
  for (const f of ['scripts/regression.test.mjs', 'tests/regression/dispatch-ok.md', 'tests/regression/dispatch-no-language.md']) {
    assert.ok(!fs.readFileSync(path.join(realRoot, f), 'utf8').includes('\r'), f);
  }
});

// ---------- seed 3: wait for CI before merging a PR ----------
// No machinery enforces this yet: the Ship Gate text and the Finish step never mention CI. The test states the
// floor and is marked todo, so it runs and reports without failing the suite. Reported as a gap in Handoff 22.
test('seed 3 lessons: the pipeline Finish step tells the Lead to wait for CI before a merge', { todo: 'no machinery covers this lesson yet' }, () => {
  const pipeline = fs.readFileSync(path.join(realRoot, 'skills', 'pipeline', 'SKILL.md'), 'utf8');
  assert.ok(/\bCI\b[^\n]*(finish|pass|green|wait)|wait[^\n]*\bCI\b/i.test(pipeline), 'pipeline names waiting for CI');
});

// ---------- seed 4 (bddd366): a project file with any problem keeps ship and security locked ----------

function settingsSandbox() {
  const root = tmp();
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  const user = (layer) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, ...layer } }));
  const projectRaw = (raw) => fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), raw);
  return { home, cwd, user, projectRaw };
}

const BAD_PROJECT_FILES = {
  'invalid JSON': '{ not json',
  'wrong version': JSON.stringify({ aico_settings: { version: 99 } }),
  'wrong value': JSON.stringify({ aico_settings: { version: 1, pipeline: { fix_rounds: 'many' } } })
};

for (const [name, raw] of Object.entries(BAD_PROJECT_FILES)) {
  test(`seed 4 bddd366: project file with ${name} holds ship and installs at ask and security and compliance on`, () => {
    const s = settingsSandbox();
    s.user({ unlocked: ['ship', 'installs', 'security'], gates: { ship: 'auto', installs: 'auto' }, pipeline: { lanes: { security: false, compliance: false } } });
    // Control: with a healthy project file the user's unlocks count.
    s.projectRaw(JSON.stringify({ aico_settings: { version: 1 } }));
    const open = resolveSettings({ home: s.home, cwd: s.cwd });
    assert.equal(open.gates.ship, 'auto');
    assert.equal(open.pipeline.lanes.security, false);
    s.projectRaw(raw);
    const r = resolveSettings({ home: s.home, cwd: s.cwd });
    assert.equal(r.gates.ship, 'ask');
    assert.equal(r.gates.installs, 'ask');
    assert.equal(r.pipeline.lanes.security, true);
    assert.equal(r.pipeline.lanes.compliance, true);
    assert.ok(r.warnings.some((w) => /held at ask/.test(w) && /held on/.test(w)), JSON.stringify(r.warnings));
    assert.ok(r.ignored.some((i) => /gates\.ship: auto from user held at ask/.test(i)), JSON.stringify(r.ignored));
  });
}

test('seed 4 bddd366: an unlocked list in the project file never unlocks anything', () => {
  const s = settingsSandbox();
  s.projectRaw(JSON.stringify({ aico_settings: { version: 1, unlocked: ['ship'], gates: { ship: 'auto' } } }));
  const r = resolveSettings({ home: s.home, cwd: s.cwd });
  assert.equal(r.gates.ship, 'ask');
  assert.deepEqual(r.unlocked, []);
  assert.ok(r.ignored.some((i) => /project unlocked: ship/.test(i)));
});

// ---------- seed 5 (052a035): incident Ship Gates always ask, the CEO sees project overrides ----------

test('seed 5 052a035: the incident Playbook makes every Ship Gate a form whatever the settings say', () => {
  const text = fs.readFileSync(path.join(realRoot, 'skills', 'incident', 'SKILL.md'), 'utf8');
  assert.match(text, /Every Ship Gate in this Playbook is a form, whatever the settings say/);
  for (const part of ['mitigation', 'each report', 'final fix']) assert.ok(text.includes(part), part);
  assert.ok(!/gates\.ship|gates\.[a-z]+\s*[:=]\s*auto/.test(text), 'incident reads no Gate setting');
});

test('seed 5 052a035: with ship auto and unlocked, a project override still reaches the CEO line data', () => {
  const s = settingsSandbox();
  s.user({ unlocked: ['ship'], gates: { ship: 'auto' } });
  s.projectRaw(JSON.stringify({ aico_settings: { version: 1, roles: { qa: { model: 'haiku' } } } }));
  const r = resolveSettings({ home: s.home, cwd: s.cwd });
  assert.ok(JSON.stringify(r.roles.qa).includes('haiku'), JSON.stringify(r.roles.qa));
  assert.ok(JSON.stringify(r.roles.qa).includes('project'), JSON.stringify(r.roles.qa));
});

test('seed 5 052a035: the pipeline shows the CEO project overrides, warnings and the empty-case line', () => {
  const text = fs.readFileSync(path.join(realRoot, 'skills', 'pipeline', 'SKILL.md'), 'utf8');
  assert.match(text, /Show the CEO in your first chat message of the run/);
  assert.match(text, /`source` is `project`/);
  assert.match(text, /Settings: no project overrides or warnings/);
});

test('the real repo passes check.mjs for the lines the seeds touch', () => {
  const { errors } = check(realRoot);
  assert.deepEqual(errors.filter((e) => /Language:|Name:|incident|pipeline/.test(e)), []);
});
