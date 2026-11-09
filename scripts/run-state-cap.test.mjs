import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { list, projects } from './run-state.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-cap-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const work = root => path.join(root, '.company', 'work');
const slugOf = i => `2026-10-01 ${String(Math.floor(i / 60)).padStart(2, '0')}.${String(i % 60).padStart(2, '0')} - Run Build`;
const START = `${JSON.stringify({ v: 1, at: '2026-11-09T12:00:00Z', ev: 'start' })}\n`;

test('list: 201 folders, 200 with run-state, gives 200 runs and no warning', () => {
  const root = repo();
  for (let i = 0; i < 201; i++) {
    const dir = path.join(work(root), slugOf(i));
    fs.mkdirSync(dir, { recursive: true });
    if (i !== 200) fs.writeFileSync(path.join(dir, 'run-state.jsonl'), START);
  }
  const r = list(root, { now: Date.parse('2026-11-09T12:01:00Z') });
  assert.equal(r.runs.length, 200);
  assert.deepEqual(r.warnings, []);
});

test('list: 201 folders with run-state gives 200 runs and the warning', () => {
  const root = repo();
  for (let i = 0; i < 201; i++) {
    const dir = path.join(work(root), slugOf(i));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.jsonl'), START);
  }
  const r = list(root, { now: Date.parse('2026-11-09T12:01:00Z') });
  assert.equal(r.runs.length, 200);
  assert.deepEqual(r.warnings, ['over 200 runs']);
});

test('projects: folders that are not runs do not count toward the cap', () => {
  const root = repo();
  for (let i = 0; i < 205; i++) fs.mkdirSync(path.join(work(root), `notes-${i}`), { recursive: true });
  const r = projects(root, { now: Date.parse('2026-11-09T12:01:00Z') });
  assert.deepEqual(r.warnings, []);
});
