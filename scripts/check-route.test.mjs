import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CHECK = join(HERE, 'check.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'check-route-'));
  dirs.push(d);
  return d;
};
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), typeof text === 'string' ? text : JSON.stringify(text));
};
const agent = name => `---\nname: ${name}\ndescription: Dispatch when testing.\ntools: Read\nmodel: sonnet\neffort: medium\n---\nBody.\n`;

// A product repo with route data and the agents the data names.
function repo({ budgets = { feature: 3, fix: 3 }, when = { 'ui-ux-designer': ['ui_changed'] }, roles = ['qa', 'ui-ux-designer', 'code-reviewer', 'senior-engineer'] } = {}) {
  const root = temp();
  for (const r of roles) write(root, `agents/${r}.md`, agent(r));
  write(root, 'company/step-budgets.json', { v: 1, budgets, source: 'test fixture' });
  write(root, 'company/role-when.json', { v: 1, when });
  return root;
}

const routeLine = (steps, extra = {}) => JSON.stringify({ v: 1, ev: 'route', playbook: 'feature', size: 'M', steps, skips: [], ...extra }) + '\n';
const stepsOf = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'qa' : 'senior-engineer', why: `step ${i}` }));

const env = () => {
  const e = { ...process.env, MCSPARROW_HOME: temp(), HOME: temp(), USERPROFILE: temp() };
  delete e.AICO_COLD;
  return e;
};
const run = (cwd, args) => spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8', env: env(), timeout: 60000 });
const out = r => `${r.stdout}${r.stderr}`;

test('AC10: a route over its Playbook budget fails check.mjs --route and names Playbook, budget and count', () => {
  const root = repo({ budgets: { feature: 3, fix: 3 } });
  write(root, 'r.jsonl', routeLine(stepsOf(5)));
  const r = run(root, ['--route', 'r.jsonl']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stdout, /ERROR route: feature over budget: budget 3, count 5/);
  assert.match(r.stdout, /1 error\(s\)/);
});

test('AC10: a route within budget passes with exit 0 and no error', () => {
  const root = repo({ budgets: { feature: 5, fix: 3 } });
  write(root, 'r.jsonl', routeLine(stepsOf(5)));
  const r = run(root, ['--route', 'r.jsonl']);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /0 error\(s\)/);
  write(root, 'company/step-budgets.json', { v: 1, budgets: { feature: 4, fix: 3 }, source: 'test fixture' });
  const over = run(root, ['--route', 'r.jsonl']);
  assert.equal(over.status, 1, out(over));
  assert.match(over.stdout, /over budget: budget 4, count 5/);
});

test('AC10: every error is listed, not only the first', () => {
  const root = repo({ budgets: { feature: 1, fix: 1 } });
  write(root, 'r.jsonl', routeLine([...stepsOf(3), { role: 'no-such-role', why: 'x' }]));
  const r = run(root, ['--route', 'r.jsonl']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stdout, /over budget: budget 1, count 4/);
  assert.match(r.stdout, /ERROR route: unknown role no-such-role/);
});

test('hostile: --route with a missing file gives a bounded check error, no stack', () => {
  const root = repo();
  const r = run(root, ['--route', 'nope.jsonl']);
  assert.notEqual(r.status, 0, out(r));
  assert.ok(out(r).length < 2000, 'output bounded');
  assert.doesNotMatch(out(r), /\n\s+at [^\n]+\(|node:internal/);
  assert.match(out(r), /route|not found|missing|refused/i);
});

test('hostile: --route with no value is a usage error', () => {
  const root = repo();
  const r = run(root, ['--route']);
  assert.equal(r.status, 2, out(r));
  assert.match(out(r), /usage/i);
});

test('hostile: --route with a folder is refused', () => {
  const root = repo();
  mkdirSync(join(root, 'adir'));
  const r = run(root, ['--route', 'adir']);
  assert.notEqual(r.status, 0, out(r));
  assert.doesNotMatch(out(r), /node:internal/);
});

test('hostile: an oversize route file is refused, not read in full', () => {
  const root = repo();
  write(root, 'big.jsonl', routeLine(stepsOf(2)) + `${'x'.repeat(70 * 1024)}\n`);
  const r = run(root, ['--route', 'big.jsonl']);
  assert.notEqual(r.status, 0, out(r));
  assert.ok(out(r).length < 2000, 'output bounded');
  assert.doesNotMatch(out(r), /x{200}/);
});

test('hostile: a route file outside the repo is refused', () => {
  const root = repo();
  const other = temp();
  write(other, 'r.jsonl', routeLine(stepsOf(1)));
  const r = run(root, ['--route', join(other, 'r.jsonl')]);
  assert.notEqual(r.status, 0, out(r));
  assert.match(out(r), /outside|refused/i);
  assert.doesNotMatch(out(r), /0 error\(s\)/);
});

test('hostile: a traversal path is refused', () => {
  const root = repo();
  const other = temp();
  write(other, 'r.jsonl', routeLine(stepsOf(1)));
  const r = run(root, ['--route', join('..', other.split(/[\\/]/).pop(), 'r.jsonl')]);
  assert.notEqual(r.status, 0, out(r));
  assert.doesNotMatch(out(r), /0 error\(s\)/);
});

test('hostile: a linked route file is refused', () => {
  const root = repo();
  write(root, 'real.jsonl', routeLine(stepsOf(5)));
  const control = run(root, ['--route', 'real.jsonl']);
  assert.match(control.stdout, /over budget: budget 3, count 5/);
  let linked = true;
  try { symlinkSync(join(root, 'real.jsonl'), join(root, 'link.jsonl')); } catch { linked = false; }
  if (!linked) return;
  const r = run(root, ['--route', 'link.jsonl']);
  assert.notEqual(r.status, 0, out(r));
  assert.doesNotMatch(out(r), /over budget/);
  assert.match(out(r), /link|refused/i);
});

test('hostile: control characters in the path are never echoed raw', () => {
  const root = repo();
  const r = run(root, ['--route', 'bad\u001b[31mname\u0007.jsonl']);
  assert.notEqual(r.status, 0, out(r));
  assert.doesNotMatch(out(r), /[\u0000-\u0008\u000b-\u001f]/);
});

test('AC14: --cold prints one note on stderr and leaves stdout as without it', () => {
  const root = repo();
  const plain = run(root, [root]);
  const cold = run(root, ['--cold', root]);
  assert.equal(cold.status, plain.status, out(cold));
  assert.match(cold.stderr, /cold/i);
  assert.equal(cold.stderr.trim().split(/\r?\n/).filter(l => /cold/i.test(l)).length, 1);
  assert.doesNotMatch(plain.stderr, /cold/i);
  assert.equal(cold.stdout, plain.stdout);
});

test('AC14: --cold does not leak AICO_COLD into this process', () => {
  const root = repo();
  const r = run(root, ['--cold', root]);
  assert.match(r.stderr, /cold/i);
  assert.equal(process.env.AICO_COLD, undefined);
});

test('AC14: --cold combines with --route', () => {
  const root = repo({ budgets: { feature: 3, fix: 3 } });
  write(root, 'r.jsonl', routeLine(stepsOf(5)));
  const r = run(root, ['--cold', '--route', 'r.jsonl']);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stdout, /over budget: budget 3, count 5/);
  assert.match(r.stderr, /cold/i);
});

test('route data: a bad role-when.json errors and the fixed one gives no route-data error', () => {
  const root = repo({ when: { 'ghost-role': ['ui_changed'] } });
  assert.ok(check(root).errors.some(e => /role-when/.test(e)));
  write(root, 'company/role-when.json', { v: 1, when: { 'ui-ux-designer': ['ui_changed'] } });
  assert.deepEqual(check(root).errors.filter(e => /role-when|step-budgets/.test(e)), []);
});

test('route data: a role-when.json that is not JSON is a check error', () => {
  const root = repo();
  write(root, 'company/role-when.json', '{ not json');
  const { errors } = check(root);
  assert.ok(errors.some(e => /^ERROR .*role-when\.json/.test(e)), errors.join('\n'));
});

test('route data: a never-skippable Role in role-when.json is a check error', () => {
  for (const slug of ['qa', 'security', 'architect', 'code-reviewer']) {
    const root = repo({ when: { [slug]: ['ui_changed'] }, roles: ['qa', 'security', 'architect', 'code-reviewer'] });
    const { errors } = check(root);
    assert.ok(errors.some(e => /role-when/.test(e) && e.includes(slug)), `${slug}: ${errors.join('\n')}`);
  }
});

test('route data: a role-when slug with no agents file is a check error', () => {
  const root = repo({ when: { 'ghost-role': ['ui_changed'] } });
  const { errors } = check(root);
  assert.ok(errors.some(e => /role-when/.test(e) && e.includes('ghost-role')), errors.join('\n'));
});

test('route data: an unknown condition in role-when.json is a check error', () => {
  const root = repo({ when: { 'ui-ux-designer': ['always_on'] } });
  const { errors } = check(root);
  assert.ok(errors.some(e => /role-when/.test(e)), errors.join('\n'));
});

test('route data: an oversize role-when.json is a check error', () => {
  const root = repo();
  write(root, 'company/role-when.json', JSON.stringify({ v: 1, when: {}, pad: 'x'.repeat(17 * 1024) }));
  const { errors } = check(root);
  assert.ok(errors.some(e => /role-when/.test(e)), errors.join('\n'));
});

test('route data: a step-budgets.json budget that is not 1-200 is a check error', () => {
  for (const bad of [0, 201, 1.5, '9']) {
    const root = repo({ budgets: { feature: bad, fix: 3 } });
    const { errors } = check(root);
    assert.ok(errors.some(e => /step-budgets/.test(e)), `${bad}: ${errors.join('\n')}`);
  }
});

test('route data: the real repo ships both data files and check(root) has no route-data error', () => {
  for (const f of ['company/step-budgets.json', 'company/role-when.json']) {
    assert.ok(existsSync(join(REPO, f)), `${f} missing`);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(REPO, f), 'utf8')), f);
  }
  const { errors } = check(REPO);
  assert.deepEqual(errors.filter(e => /role-when|step-budgets|route/i.test(e)), []);
});
