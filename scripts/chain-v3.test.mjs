import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isProjectId, isWorkFolder } from '../mods/lib/work-folder.mjs';
import { main } from './work-folder.mjs';
import { runSlugs, projects } from './run-state.mjs';

// AC4 on the flipped CLI (work-folder-name v3.0): bug, grill, reprompt x2, bug, grill, fix chained by `project:` lines
// (`new --playbook <pb> --project <ID>`) make one top-level entry, seven runs and one branch. Public interface:
// scripts/work-folder.mjs#main and scripts/run-state.mjs (runSlugs, projects).
const NOW = new Date(2026, 10, 9, 16, 30, 0);
const CHAIN = ['bug', 'grill', 'reprompt', 'reprompt', 'bug', 'grill', 'fix'];

const dirs = [];
const saved = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
before(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-v3-home-'));
  dirs.push(home);
  process.env.MCSPARROW_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-v3-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const work = root => path.join(root, '.company', 'work');
const top = root => fs.readdirSync(work(root)).sort();
const sub = (root, id) => fs.readdirSync(path.join(work(root), id)).sort();
const pad = n => String(n).padStart(2, '0');

// The chain as the Playbooks run it: the first Playbook makes the project, each later one joins it with the `project:` ID.
function runChain(root) {
  const results = [];
  let id = null;
  for (const pb of CHAIN) {
    const res = id === null
      ? (fs.writeFileSync(path.join(root, '.company', `work-folder-topic-${pb}.txt`), 'Fix the login\n'),
        main(['new', '--playbook', pb, '--topic', 'file'], { root, now: NOW }))
      : main(['new', '--playbook', pb, '--project', id], { root, now: NOW });
    assert.equal(res.code, 0, `${pb}: ${res.lines.join('\n')}`);
    if (id === null) id = res.lines[0].replace(/^id: /, '');
    results.push(res);
  }
  return { id, results };
}

describe('chain bug, grill, reprompt x2, bug, grill, fix on the v3 CLI (AC4)', () => {
  test('one top-level entry: the project folder, no v2 sibling folder', () => {
    const root = product();
    const { id } = runChain(root);
    assert.ok(isProjectId(id), id);
    assert.deepEqual(top(root), [id]);
    assert.ok(!top(root).some(isWorkFolder), 'no v2 <ID>-HH.MM.SS folder');
  });

  test('seven runs numbered 01..07 in the chain order, plus 00-project.md', () => {
    const root = product();
    const { id } = runChain(root);
    const want = ['00-project.md', ...CHAIN.map((pb, i) => `${pad(i + 1)}-${pb}`)];
    assert.deepEqual(sub(root, id), want);
  });

  test('every step prints the same id, the run slug as name and one branch aico/<ID>', () => {
    const root = product();
    const { id, results } = runChain(root);
    results.forEach((res, i) => {
      assert.deepEqual(res.lines, [`id: ${id}`, `name: ${id}/${pad(i + 1)}-${CHAIN[i]}`, `branch: aico/${id}`], CHAIN[i]);
    });
    assert.equal(new Set(results.map(r => r.lines[2])).size, 1);
  });

  test('work-folder branch on any run slug of the chain prints the one branch', () => {
    const root = product();
    const { id } = runChain(root);
    for (let i = 0; i < CHAIN.length; i++) {
      const res = main(['branch', `${id}/${pad(i + 1)}-${CHAIN[i]}`], { root, now: NOW });
      assert.deepEqual(res, { code: 0, lines: [`branch: aico/${id}`] }, CHAIN[i]);
    }
  });

  test('run-state sees one project and seven runs, newest first', () => {
    const root = product();
    const { id } = runChain(root);
    const { slugs, capped } = runSlugs(root);
    assert.equal(capped, false);
    assert.deepEqual(slugs, CHAIN.map((pb, i) => `${id}/${pad(i + 1)}-${pb}`).reverse());
    const p = projects(root, { now: Date.now() });
    assert.deepEqual(p.projects.map(x => x.id), [id]);
  });

  test('the same two reprompt runs never overwrite each other', () => {
    const root = product();
    const { id } = runChain(root);
    for (const n of ['03-reprompt', '04-reprompt']) {
      assert.ok(fs.statSync(path.join(work(root), id, n, '00-summary.md')).isFile(), n);
    }
  });

  test('--layout is refused with usage and writes nothing, for v3 and any other value', () => {
    for (const value of ['v3', 'v2', '']) {
      const root = product();
      fs.writeFileSync(path.join(root, '.company', 'work-folder-topic-bug.txt'), 'Fix the login\n');
      const res = main(['new', '--playbook', 'bug', '--topic', 'file', '--layout', value], { root, now: NOW });
      assert.equal(res.code, 3, `--layout ${value}`);
      assert.deepEqual(res.lines, ['refused: usage']);
      assert.deepEqual(top(root), [], 'nothing written');
    }
  });

  test('a join of an unknown project ID makes nothing', () => {
    const root = product();
    runChain(root);
    const before = top(root);
    const res = main(['new', '--playbook', 'fix', '--project', 'P20261109.999999'], { root, now: NOW });
    assert.notEqual(res.code, 0);
    assert.deepEqual(top(root), before);
  });
});
