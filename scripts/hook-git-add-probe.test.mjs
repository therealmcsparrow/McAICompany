// Tests: directory probes for bare shell tokens follow `git -C <dir>` and `cd <dir>`, and fail closed when they run out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize } from '../hooks/lib/event.mjs';
import { judge } from '../hooks/rules/git-add.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = () => ({ env: {}, schema: null, pluginRoot: ROOT, mcsHome: path.join(os.tmpdir(), 'mcs-none'), resolveRun: null });

async function withRepo(fn) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gap-')));
  try {
    fs.mkdirSync(path.join(tmp, 'outside'));
    fs.mkdirSync(path.join(tmp, 'repo', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'repo', 'hooks', 'lib'), { recursive: true });
    return await fn(tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const verdict = async (command, cwd) => {
  const r = await normalize({ hook_event_name: 'PreToolUse', session_id: 's', cwd, tool_name: 'Bash', tool_input: { command } }, mk());
  return judge(r.event).v;
};

test('git -C <repo> add <dir> denies from a cwd outside the repo', () => withRepo(async (tmp) => {
  const repo = path.join(tmp, 'repo').replaceAll(path.sep, '/');
  assert.equal(await verdict(`git -C ${repo} add scripts`, path.join(tmp, 'outside')), 'deny');
  assert.equal(await verdict(`git -C repo add scripts`, tmp), 'deny');
  assert.equal(await verdict(`git -C ${repo} add hooks/lib`, path.join(tmp, 'outside')), 'deny');
}));

test('cd <dir> && git add <dir> denies', () => withRepo(async (tmp) => {
  assert.equal(await verdict('cd repo/hooks && git add lib', tmp), 'deny');
  assert.equal(await verdict('cd repo && cd hooks && git add lib', tmp), 'deny');
}));

test('named files still pass under -C and cd', () => withRepo(async (tmp) => {
  assert.equal(await verdict('git -C repo add package.json', tmp), 'allow');
  assert.equal(await verdict('cd repo && git add package.json', tmp), 'allow');
}));

test('64+ bare words before git add <dir> fail closed', () => withRepo(async (tmp) => {
  const words = Array.from({ length: 70 }, (_, i) => `w${i}`).join(' ');
  assert.equal(await verdict(`echo ${words}; git add scripts`, path.join(tmp, 'repo')), 'deny');
}));

test('long commit message then -- <dir> denies; named file passes', () => withRepo(async (tmp) => {
  const words = Array.from({ length: 70 }, (_, i) => `w${i}`).join(' ');
  const cwd = path.join(tmp, 'repo');
  assert.equal(await verdict(`git commit -m "${words}" -- hooks`, cwd), 'deny');
  assert.equal(await verdict(`git commit -m "${words}" -- package.json`, cwd), 'allow');
  assert.equal(await verdict(`git commit -m "${words}"`, cwd), 'allow');
}));

test('Push-Location and pushd variants are followed like cd', () => withRepo(async (tmp) => {
  assert.equal(await verdict('Push-Location repo/hooks; git add lib', tmp), 'deny');
  assert.equal(await verdict('push-location repo/hooks; git add lib', tmp), 'deny');
  assert.equal(await verdict('pushd repo/hooks && git add lib', tmp), 'deny');
}));

test('a huge command of cd targets stays fast and fails closed', () => withRepo(async (tmp) => {
  const cds = Array.from({ length: 8000 }, () => 'cd repo; cd ..;').join(' ');
  const start = Date.now();
  assert.equal(await verdict(`${cds} git add scripts`, tmp), 'deny');
  assert.ok(Date.now() - start < 1500);
}));

test('an unreadable -C or cd target fails closed', () => withRepo(async (tmp) => {
  assert.equal(await verdict('git -C missing add scripts', tmp), 'deny');
  assert.equal(await verdict('git -C "$R" add scripts', tmp), 'deny');
  assert.equal(await verdict('cd missing && git add scripts', tmp), 'deny');
}));
