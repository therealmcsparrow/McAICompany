import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const HERE = import.meta.dirname;
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function block(id, context) {
  return [
    `### ${id} task ${id}`,
    '- role: backend-engineer',
    `- files: src/${id.toLowerCase()}.js, src/${id.toLowerCase()}.test.js`,
    '- depends-on: none',
    '- parallel: yes',
    `- context: ${context}`,
    `- slice: caller sends input -> receives the checked result — demo: src/${id.toLowerCase()}.test.js`,
    '- seams: none — no other file is touched by this task',
    '',
  ].join('\n');
}

function world(...contexts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tasks-handover-'));
  roots.push(root);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'backend-engineer.md'), 'agent\n');
  const product = path.join(root, 'product');
  const dir = path.join(product, '.company', 'work', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '02-plan.md'), contexts.map((c, i) => block(`T${i + 1}`, c)).join('\n'));
  const check = (...extra) => main(['check', 'demo', '02-plan.md', '--cap', '4', '--mode', 'parallel', ...extra], { now: NOW, root: product, pluginRoot });
  return { check };
}

describe('plan-tasks check --handover against a run handover', () => {
  test('context 150k passes at handover 162000 and 170k errors', () => {
    const ok = world('150k').check('--handover', '162000');
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    assert.match(ok.lines.at(-1), /^plan-tasks: 0 errors \(handover 162000\)$/);
    const bad = world('170k').check('--handover', '162000');
    assert.equal(bad.code, 2);
    assert.ok(bad.lines.includes('ERROR T1: context: 170k above handover 162000'), bad.lines.join('\n'));
    assert.match(bad.lines.at(-1), /^plan-tasks: 1 errors \(handover 162000\)$/);
  });

  test('both tasks in one plan are judged separately', () => {
    const r = world('150k', '170k').check('--handover', '162000');
    assert.equal(r.code, 2);
    assert.ok(!r.lines.some((l) => l.startsWith('ERROR T1:')));
    assert.ok(r.lines.includes('ERROR T2: context: 170k above handover 162000'));
  });

  test('a smaller run handover turns the same 150k into an error', () => {
    const r = world('150k').check('--handover', '85500');
    assert.equal(r.code, 2);
    assert.ok(r.lines.includes('ERROR T1: context: 150k above handover 85500'));
  });

  test('the range ends are accepted', () => {
    assert.equal(world('10k').check('--handover', '10000').code, 0);
    assert.equal(world('10k').check('--handover', '1000000').code, 0);
  });

  const hostile = ['0', '-1', '-162000', '1.5', '162000.0', '12e4', '0x2710', 'abc', '', ' 162000', '162000 ', '9999', '1000001', '99999999', '162000\n', '$(id)', '../x'];
  for (const value of hostile) {
    test(`hostile --handover ${JSON.stringify(value)} is refused and not echoed`, () => {
      const r = world('150k').check('--handover', value);
      assert.equal(r.code, 3, r.lines.join('\n'));
      assert.equal(r.lines.length, 1);
      assert.match(r.lines[0], /^refused: /);
      if (!/[\u0000-\u001f]/.test(value)) assert.match(r.lines[0], /handover/);
      for (const part of value.split(/\s+/).filter((x) => x.length > 1)) assert.ok(!r.lines[0].includes(part), `echoes ${part}`);
    });
  }

  test('a missing value after --handover is refused', () => {
    const r = world('150k').check('--handover');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
  });

  test('a repeated --handover is refused', () => {
    const r = world('150k').check('--handover', '162000', '--handover', '85500');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
  });
});

describe('skill and contract text name the run cap', () => {
  const pipeline = read('skills', 'pipeline', 'SKILL.md');
  const handoff = read('skills', 'handoff', 'SKILL.md');

  test('Setup item 8 reads cap and handover from run-state and hands the handover to plan-tasks', () => {
    const item = pipeline.split('\n').find((l) => l.startsWith('8. **Context cap (§1.7)**'));
    assert.ok(item, 'Setup item 8 missing');
    for (const needle of ['`run-state show <slug> --json`', '`cap`', '`handover`', '`pipeline.context_cap`', '`plan-tasks check|begin --handover`']) {
      assert.ok(item.includes(needle), `item 8 lacks ${needle}`);
    }
    assert.doesNotMatch(item, /95000|85500|no settings read|fixed for every Role/);
  });

  test('the dispatch template carries run values, never typed figures', () => {
    assert.match(pipeline, /^Context cap: <[a-z-]+> handover <[a-z-]+>/m);
    assert.doesNotMatch(pipeline, /95000|85500/);
  });

  test('the absent Context cap line means 180000 and 162000 in the Role text', () => {
    assert.ok(handoff.includes('Absent → cap 180000, handover at 162000.'), 'absent default sentence missing');
    assert.doesNotMatch(handoff, /95000|85500/);
  });

  test('the plan-tasks contract body no longer states 0.8, 95000 or 85500', () => {
    const doc = read('docs', 'contracts', 'plan-tasks.md');
    const body = doc.slice(doc.indexOf('\n## '));
    assert.doesNotMatch(body, /0\.8|95000|85500/);
  });
});
