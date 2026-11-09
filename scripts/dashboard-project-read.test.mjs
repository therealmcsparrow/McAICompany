// The project card reads 00-project.md only when it is one plain file inside the work folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { board } from './dashboard-data.mjs';
import { makeDeps, view, entry, NOW } from './dashboard-board-fixtures.mjs';

const PROJ = 'P20261109.000009';
const RUN = `${PROJ}/01-feature`;

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.company', 'work', RUN);
  fs.mkdirSync(dir, { recursive: true });
  return { root, file: path.join(root, '.company', 'work', PROJ, '00-project.md') };
}

async function card(root) {
  const runs = [entry(RUN, { started: '2026-11-09T09:00:00Z' })];
  const views = { [RUN]: view({ state: runs[0].state, started: runs[0].started }) };
  const b = await board(root, { now: NOW, deps: makeDeps({ runs, views }).deps });
  return b.columns.flatMap((c) => c.cards).find((c) => c.kind === 'project');
}

test('a plain 00-project.md gives the description', async (t) => {
  const { root, file } = setup(t);
  fs.writeFileSync(file, 'Plain description\n');
  const c = await card(root);
  assert.equal(c.description, 'Plain description');
  assert.equal(c.title, 'Plain description');
});

test('a hard link to a file outside the work folder gives no title or description', async (t) => {
  const { root, file } = setup(t);
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'Outside secret\n');
  fs.linkSync(outside, file);
  const c = await card(root);
  assert.equal(c.description, '');
  assert.equal(c.title, PROJ);
});

test('a symbolic link gives no description', async (t) => {
  const { root, file } = setup(t);
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'Outside secret\n');
  try {
    fs.symlinkSync(outside, file);
  } catch {
    t.skip('symlinks not allowed here');
    return;
  }
  const c = await card(root);
  assert.equal(c.description, '');
});
