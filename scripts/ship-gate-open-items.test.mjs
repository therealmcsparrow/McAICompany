import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from './plan-tasks.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

// Open items from the QA Tests First Active Ship Gate (v0.30.0).

describe('item 5: the role is qa, not qa-tester', () => {
  test('no tracked file names the old role id qa-tester', () => {
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
    const hits = [];
    for (const rel of files) {
      if (rel === 'scripts/ship-gate-open-items.test.mjs') continue;
      let text;
      try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
      if (/qa-tester/i.test(text)) hits.push(rel);
    }
    assert.deepEqual(hits, []);
  });
});

describe('item 3: feedback skill cites token-ledger v1.10 on its qa-first-report line', () => {
  test('the QA first line carries the cite', () => {
    const line = read('skills/feedback/SKILL.md').split('\n').find((l) => /ledger qa-first-report/.test(l));
    assert.ok(line, 'feedback has a qa-first-report line');
    assert.match(line, /token-ledger`? v1\.10/);
  });
});

describe('item 1: review nits R-10, R-11 (feedback pins read the line, not the file)', () => {
  const line = () => read('skills/feedback/SKILL.md').split('\n').find((l) => /ledger qa-first-report/.test(l)) ?? '';
  test('R-10 the qa-first-report line itself says unchanged and names ## QA first', () => {
    assert.match(line(), /## QA first/);
    assert.match(line(), /unchanged/);
  });
  test('R-11 only one line in feedback runs ledger qa-first-report', () => {
    const n = read('skills/feedback/SKILL.md').split('\n').filter((l) => /ledger qa-first-report/.test(l)).length;
    assert.equal(n, 1);
  });
});

describe('item 1: R-2 message names the cause for a non-QA task with no files', () => {
  const roots = [];
  const savedHome = process.env.MCSPARROW_HOME;
  after(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.MCSPARROW_HOME;
    else process.env.MCSPARROW_HOME = savedHome;
  });
  test('check --qa-first on a docs task without files: names missing or invalid files', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-gate-r2-'));
    roots.push(base);
    const home = path.join(base, 'home');
    const product = path.join(base, 'product');
    const pluginRoot = path.join(base, 'plugin');
    fs.mkdirSync(home, { recursive: true });
    process.env.MCSPARROW_HOME = home;
    fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
    for (const a of ['backend-engineer', 'qa']) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
    const dir = path.join(product, '.company', 'work', 'demo');
    fs.mkdirSync(dir, { recursive: true });
    const A = '\u2192', D = '\u2014';
    const t = (id, extra) => [`### ${id} title`, ...extra, ''].join('\n');
    const qaTask = t('T1', ['- role: qa', '- files: tests/a.test.mjs', '- depends-on: none', '- parallel: yes', '- context: 20k',
      `- slice: a user submits ${A} the page shows it ${D} demo: tests/a.test.mjs`, `- seams: none ${D} tests only, no code`]);
    const docs = t('T3', ['- role: backend-engineer', '- depends-on: T1', '- parallel: yes', '- context: 20k',
      `- slice: a user reads ${A} the page shows docs ${D} demo: docs/x.md`, `- seams: none ${D} docs only`]);
    fs.writeFileSync(path.join(dir, '02-plan.md'), `# Plan\n\n## Tasks\n\n${qaTask}\n${docs}`);
    const r = main(['check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel', '--qa-first'],
      { now: Date.UTC(2026, 10, 8, 12), root: product, pluginRoot, home });
    const err = r.lines.filter((l) => l.startsWith('ERROR '));
    assert.ok(err.length > 0, 'fail-closed stays: the task is still refused');
    assert.match(err.join('\n'), /files? (is |are )?(missing|invalid|not valid)|(missing|invalid) files?/i);
  });
});
