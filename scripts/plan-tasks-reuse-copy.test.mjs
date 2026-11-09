import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as planTasks } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 10, 8, 21, 30, 0);
const P1 = 'P20261108.000001';
const F1 = `${P1}-22.25.00`;
const F2 = `${P1}-23.10.05`;
const ARROW = '\u2192';
const DASH = '\u2014';

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function env(folders) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-copy-'));
  roots.push(base);
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(path.join(base, 'home'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'backend-engineer.md'), 'agent\n');
  for (const [name, text] of Object.entries(folders)) {
    const dir = path.join(product, '.company', 'work', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '02-plan.md'), text);
  }
  const ctx = { now: NOW, root: product, pluginRoot, home: path.join(base, 'home') };
  return {
    product,
    check: (folder) => planTasks(['check', folder, '02-plan.md', '--cap', '3', '--mode', 'parallel'], ctx)
  };
}

function task(id, file = `src/${id.replace(/[^A-Za-z0-9]/g, '-')}.js`) {
  return [
    `### ${id} title of the task`,
    '- role: backend-engineer',
    `- files: ${file}`,
    '- depends-on: none',
    '- parallel: yes',
    '- context: 20k',
    `- slice: a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${file}`,
    `- seams: ${file}#run`,
    ''
  ].join('\n');
}

const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const text = (r) => r.lines.join('\n');

test('a copy of a sibling block passes, also with CRLF', () => {
  const body = plan(task(`${P1}-T1`), task(`${P1}-T2`));
  const e = env({ [F1]: body, [F2]: body.replace(/\n/g, '\r\n') });
  const r = e.check(F2);
  assert.equal(r.code, 0, text(r));
});

test('a sibling block under the same ID that differs is refused', () => {
  const e = env({ [F1]: plan(task(`${P1}-T1`)), [F2]: plan(task(`${P1}-T1`, 'src/other.js')) });
  const r = e.check(F2);
  assert.notEqual(r.code, 0);
  assert.ok(text(r).includes('ticket-reused'), text(r));
});

test('a different heading line under the same ID is refused', () => {
  const a = plan(task(`${P1}-T1`));
  const e = env({ [F1]: a, [F2]: a.replace('title of the task', 'another title') });
  const r = e.check(F2);
  assert.ok(text(r).includes('ticket-reused'), text(r));
});

test('more than 200 unrelated folders do not hide a reuse', () => {
  const folders = {};
  for (let i = 0; i < 250; i++) folders[`2026-01-01 00.00 - Old ${String(i).padStart(3, '0')}`] = plan(task('T1'));
  folders[F1] = plan(task(`${P1}-T1`));
  folders[F2] = plan(task(`${P1}-T1`, 'src/other.js'));
  const r = env(folders).check(F2);
  assert.ok(text(r).includes('ticket-reused'), text(r));
});
