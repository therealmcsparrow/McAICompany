// Tests: path extraction in hooks/lib/event.mjs (Grep glob, bare directory operands, run guard record) and the git-add rule on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, fold } from '../hooks/lib/event.mjs';
import { judge } from '../hooks/rules/git-add.mjs';
import { judge as judgeEnv } from '../hooks/rules/dotenv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = (extra = {}) => ({ env: {}, schema: null, pluginRoot: ROOT, mcsHome: path.join(os.tmpdir(), 'mcs-none'), resolveRun: null, ...extra });
const pre = (tool_name, tool_input, cwd = ROOT) => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd, tool_name, tool_input });

test('Grep glob becomes a path entry', async () => {
  const r = await normalize(pre('Grep', { pattern: 'x', glob: '.env', path: '.' }), mk());
  assert.ok(r.event.tool.paths.some((p) => p.raw === '.env'));
  assert.equal(judgeEnv(r.event).v, 'deny');
});

test('bare directory operand gets a dir entry; git add scripts denies', async () => {
  const r = await normalize(pre('Bash', { command: 'git add scripts' }), mk());
  assert.ok(r.event.tool.paths.some((p) => p.raw === 'scripts' && p.dir === true));
  assert.equal(judge(r.event).v, 'deny');
});

test('git add -- hooks and :/scripts deny', async () => {
  for (const command of ['git add -- hooks', 'git add :/scripts']) {
    const r = await normalize(pre('Bash', { command }), mk());
    assert.equal(judge(r.event).v, 'deny', command);
  }
});

test('git commit with a directory or dot pathspec denies; a named file passes', async () => {
  for (const command of ['git commit .', 'git commit -m x .', 'git commit -m x -- .', 'git commit -i .', 'git commit -m x scripts']) {
    const r = await normalize(pre('Bash', { command }), mk());
    assert.equal(judge(r.event).v, 'deny', command);
  }
  for (const command of ['git commit -m "fix scripts"', 'git commit -m x -- package.json', 'git commit --amend --no-edit']) {
    const r = await normalize(pre('Bash', { command }), mk());
    assert.equal(judge(r.event).v, 'allow', command);
  }
});

test('protected holds each run guard record', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evp-'));
  try {
    fs.mkdirSync(path.join(tmp, '.company', 'work', 'run1'), { recursive: true });
    const r = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk());
    const want = fold(fs.realpathSync.native(path.join(tmp, '.company', 'work', 'run1')) + path.sep + 'guard.jsonl');
    assert.ok(r.event.protected.includes(want));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
