import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROTECTED_ROLES as SETTINGS_PROTECTED } from './settings.mjs';
import { PROTECTED_ROLES as CHECK_PROTECTED, check } from './check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const SIX = ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'];

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fresh-reviewer-')); temps.push(d); return d; };

function run(script, args, { cwd, home }) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('hostile: a project model of haiku at tier medium is not applied and warns', () => {
  const dir = tmp();
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  mkdirSync(home);
  mkdirSync(join(repo, '.company'), { recursive: true });
  writeFileSync(join(repo, '.company', 'settings.json'),
    JSON.stringify({ aico_settings: { version: 1, roles: { 'fresh-reviewer': { model: 'haiku' } } } }));
  writeFileSync(join(repo, '.company', 'project.md'), '---\ntier: medium\n---\n');
  const r = run('settings.mjs', ['get'], { cwd: repo, home });
  assert.equal(r.code, 0, r.err);
  const got = JSON.parse(r.out);
  assert.equal(got.roles['fresh-reviewer'].model, 'opus');
  assert.equal(got.roles['fresh-reviewer'].protected, true);
  assert.equal(got.roles['fresh-reviewer'].floor, 'opus');
  assert.ok(got.warnings.includes('roles.fresh-reviewer.model: haiku is below the protected floor opus, not applied'), r.out);
});

test('settings.mjs get lists the Role as protected with the default name', () => {
  const dir = tmp();
  const home = join(dir, 'home');
  mkdirSync(home);
  const r = run('settings.mjs', ['get'], { cwd: dir, home });
  assert.equal(r.code, 0, r.err);
  const role = JSON.parse(r.out).roles['fresh-reviewer'];
  assert.equal(role.protected, true);
  assert.equal(role.name, 'Fenna');
  assert.equal(role.model, 'opus');
});

test('both PROTECTED_ROLES constants and the floor file hold the same six names', () => {
  assert.deepEqual([...SETTINGS_PROTECTED].sort(), SIX);
  assert.deepEqual([...CHECK_PROTECTED].sort(), SIX);
  const floor = JSON.parse(read('company/model-floor.json'));
  assert.deepEqual([...floor.protected].sort(), SIX);
  assert.equal(floor.floor['fresh-reviewer'], 'opus');
});

// A copy of the plugin tree that check() reads, with the floor file changed.
function pluginCopy(mutateFloor) {
  const dir = tmp();
  for (const d of ['agents', 'skills', 'company', 'docs']) cpSync(join(root, d), join(dir, d), { recursive: true });
  const file = join(dir, 'company', 'model-floor.json');
  const floor = JSON.parse(readFileSync(file, 'utf8'));
  mutateFloor(floor);
  writeFileSync(file, JSON.stringify(floor));
  return dir;
}

test('check.mjs passes with the six names', () => {
  const r = check(pluginCopy(() => {}));
  assert.deepEqual(r.errors.filter((e) => /model-floor|protected|has no floor|below its floor/.test(e)), []);
});

test('check.mjs fails on a floor file with the old five names', () => {
  const r = check(pluginCopy((f) => { f.protected = f.protected.filter((n) => n !== 'fresh-reviewer'); }));
  assert.ok(r.errors.some((e) => e.includes('protected must be exactly')), r.errors.join('\n'));
});

test('check.mjs fails when the fresh-reviewer floor entry is missing', () => {
  const r = check(pluginCopy((f) => { delete f.floor['fresh-reviewer']; }));
  assert.ok(r.errors.some((e) => e.includes('fresh-reviewer has no floor')), r.errors.join('\n'));
});

test('names, personalities and manifests', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names['fresh-reviewer'], 'Fenna');
  const agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(names).sort(), agents.sort());
  const p = JSON.parse(read('company/personalities.json'))['fresh-reviewer'];
  assert.deepEqual(p, { temperament: 'calm and curious', talk: 'plain questions, one at a time', topic: 'what a text really says', intelligence: 'high', creativity: 'medium' });
  for (const id of ['software', 'design']) assert.ok(JSON.parse(read(`company/types/${id}.json`)).roles.includes('fresh-reviewer'), id);
  for (const id of ['marketing', 'research']) assert.ok(!JSON.parse(read(`company/types/${id}.json`)).roles.includes('fresh-reviewer'), id);
});

test('company-type check-role is ok under software and design', () => {
  for (const type of ['software', 'design']) {
    const dir = tmp();
    const home = join(dir, 'home');
    mkdirSync(home);
    mkdirSync(join(dir, '.company'));
    writeFileSync(join(dir, '.company', 'project.md'), `company_type: ${type}\n`);
    const r = run('company-type.mjs', ['check-role', 'fresh-reviewer'], { cwd: dir, home });
    assert.equal(r.code, 0, `${type}: ${r.out}${r.err}`);
  }
});
