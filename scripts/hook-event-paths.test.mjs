// Tests: path extraction in hooks/lib/event.mjs (Grep glob, bare directory operands, run guard record) and that git add / git commit are no longer a guard (ADR 0079).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, fold } from '../hooks/lib/event.mjs';
import { judge as judgeEnv } from '../hooks/rules/dotenv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = (extra = {}) => ({ env: {}, schema: null, pluginRoot: ROOT, mcsHome: path.join(os.tmpdir(), 'mcs-none'), resolveRun: null, ...extra });
const pre = (tool_name, tool_input, cwd = ROOT) => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd, tool_name, tool_input });

test('Grep glob becomes a path entry', async () => {
  const r = await normalize(pre('Grep', { pattern: 'x', glob: '.env', path: '.' }), mk());
  assert.ok(r.event.tool.paths.some((p) => p.raw === '.env'));
  assert.equal(judgeEnv(r.event).v, 'deny');
});

test('bare directory operand still gets a dir entry; git add scripts is not denied by dotenv', async () => {
  const r = await normalize(pre('Bash', { command: 'git add scripts' }), mk());
  assert.ok(r.event.tool.paths.some((p) => p.raw === 'scripts' && p.dir === true));
  assert.equal(judgeEnv(r.event).v, 'allow');
});

test('git add -A, git add . and git commit -a get no deny from any rule (ADR 0079)', async () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'hooks', 'rules', 'git-add.mjs')), 'hooks/rules/git-add.mjs removed');
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'rules.json'), 'utf8'));
  assert.ok(!rows.some((x) => /git-add/.test(JSON.stringify(x))), 'no git-add row in hooks/rules.json');
  for (const command of ['git add -A', 'git add .', 'git add -- hooks', 'git commit -a', 'git commit -am x', 'git commit -m x .']) {
    const r = await normalize(pre('Bash', { command }), mk());
    assert.equal(judgeEnv(r.event).v, 'allow', command);
  }
});

test('ctx.memo keeps protected per cwd for one Map only and never aliases the cached list', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-'));
  try {
    const rec = (run, step) => fold(fs.realpathSync.native(path.join(tmp, '.company', 'work', run, step)) + path.sep + 'guard.jsonl');
    fs.mkdirSync(path.join(tmp, '.company', 'work', 'P1', '01-a'), { recursive: true });
    const memo = new Map();
    const first = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk({ memo }));
    assert.ok(first.event.protected.includes(rec('P1', '01-a')));
    fs.mkdirSync(path.join(tmp, '.company', 'work', 'P2', '01-b'), { recursive: true });
    const second = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk({ memo }));
    assert.deepEqual(second.event.protected, first.event.protected);
    assert.ok(!second.event.protected.includes(rec('P2', '01-b')));
    const fresh = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk());
    assert.ok(fresh.event.protected.includes(rec('P2', '01-b')));
    const extra = path.join(tmp, '.company', 'work', 'X', 'guard.jsonl');
    const w = await normalize(pre('Write', { file_path: extra, content: 'x' }, tmp), mk({ memo }));
    assert.ok(w.event.protected.includes(fold(extra)));
    const again = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk({ memo }));
    assert.ok(!again.event.protected.includes(fold(extra)));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
