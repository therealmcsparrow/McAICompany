// The i-have-adhd command is registered like the other always-on, CEO-only commands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ALWAYS, CEO_ONLY, TYPE_ORDER } from './company-type.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(root, 'scripts', 'company-type.mjs');
const BASE = 'df41d910ebd65ceb8e91bc393fc774a7e38f7035';
const NAME = 'i-have-adhd';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// A throwaway project of the given type, with home variables pointed at a temp dir.
function sandbox(type) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-reg-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.company'));
  fs.writeFileSync(path.join(dir, '.company', 'project.md'), `# Project profile\n\ncompany_type: ${type}\n`);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { cwd: dir, env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home } };
}

function checkPlaybook(type, name) {
  const { cwd, env } = sandbox(type);
  return spawnSync(process.execPath, [SCRIPT, 'check-playbook', name], { cwd, env, encoding: 'utf8' });
}

test('i-have-adhd sits in ALWAYS between add-skill and reprompt', () => {
  const i = ALWAYS.indexOf(NAME);
  assert.ok(i > 0, 'i-have-adhd is in ALWAYS');
  assert.equal(ALWAYS[i - 1], 'add-skill');
  assert.equal(ALWAYS[i + 1], 'reprompt');
});

for (const type of TYPE_ORDER) {
  test(`check-playbook i-have-adhd exits 0 in the ${type} company`, () => {
    const r = checkPlaybook(type, NAME);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
}

test('a name that is not registered is still refused (the check is not vacuous)', () => {
  const r = checkPlaybook('software', 'i-have-adhd-x');
  assert.equal(r.status, 2);
});

test('i-have-adhd is hidden from the Skill tool: it is in CEO_ONLY and its skill is flagged', () => {
  assert.ok(CEO_ONLY.includes(NAME), 'CEO_ONLY lists i-have-adhd');
  const text = fs.readFileSync(path.join(root, 'skills', NAME, 'SKILL.md'), 'utf8');
  const front = text.split(/^---$/m)[1];
  assert.match(front, /^disable-model-invocation: true$/m);
  assert.match(front, /^argument-hint: "\[help\]"$/m);
});

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const baseKnown = (() => {
  try { git('rev-parse', '--verify', '--quiet', '--end-of-options', `${BASE}^{commit}`); return true; } catch { return false; }
})();

test('dependencies and the plugin manifest equal the base commit', { skip: !baseKnown && 'base commit is not in this checkout' }, () => {
  const paths = ['deps', 'package.json', 'package-lock.json', '.claude-plugin/plugin.json'];
  const changed = git('diff', '--name-only', '--end-of-options', BASE, '--', ...paths).split('\n').filter(Boolean);
  assert.deepEqual(changed, []);
});
