// Tests: every run's guard record stays protected at any depth under .company/work, with the real
// <ProjectID>/<NN-sub> layout, whether or not the file exists yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, fold } from '../hooks/lib/event.mjs';
import { judge } from '../hooks/rules/self-protect.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const mk = () => ({ env: {}, schema: null, pluginRoot: ROOT, mcsHome: path.join(os.tmpdir(), 'mcs-none'), resolveRun: null });
const pre = (tool_name, tool_input, cwd) => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd, tool_name, tool_input });
const LAYOUT = ['.company', 'work', 'P20261114.000001', '01-feature'];

async function withRun(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdepth-'));
  try {
    fs.mkdirSync(path.join(tmp, ...LAYOUT), { recursive: true });
    return await fn(tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('protected holds the guard record of a two-level run folder', () => withRun(async (tmp) => {
  const r = await normalize(pre('Read', { file_path: 'a.txt' }, tmp), mk());
  const want = fold(path.join(fs.realpathSync.native(tmp), ...LAYOUT, 'guard.jsonl'));
  assert.ok(r.event.protected.includes(want));
}));

test('Write to a two-level guard record denies, file absent', () => withRun(async (tmp) => {
  const file = path.join(tmp, ...LAYOUT, 'guard.jsonl');
  assert.equal(fs.existsSync(file), false);
  const r = await normalize(pre('Write', { file_path: file, content: 'x' }, tmp), mk());
  assert.equal(judge(r.event).v, 'deny');
}));

test('Write to a guard record in a run folder not yet created denies', () => withRun(async (tmp) => {
  const file = path.join(tmp, '.company', 'work', 'P20261114.000002', '02-fix', 'guard.jsonl');
  const r = await normalize(pre('Write', { file_path: file, content: 'x' }, tmp), mk());
  assert.equal(judge(r.event).v, 'deny');
}));

test('echo append to a two-level guard record denies', () => withRun(async (tmp) => {
  const command = 'echo {} >> .company/work/P20261114.000001/01-feature/guard.jsonl';
  const r = await normalize(pre('Bash', { command }, tmp), mk());
  assert.equal(judge(r.event).v, 'deny');
}));

test('a guard.jsonl outside .company/work is not swept in', () => withRun(async (tmp) => {
  const file = path.join(tmp, 'src', 'guard.jsonl');
  const r = await normalize(pre('Write', { file_path: file, content: 'x' }, tmp), mk());
  assert.ok(!r.event.protected.includes(fold(file)));
}));
