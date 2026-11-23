import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// plan-review v1.5 (AC5): `majors` prints `skipped (settings off)` when pipeline.plan_review is off (the default),
// and behaves as before when it is on. Driven through the CLI, with the settings read from the product root and a private home.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '..', 'tests', 'fixtures', 'plan-review');
const SCRIPT = path.join(HERE, 'plan-review.mjs');
const RUN = '.company/work/demo';
const PLAN = '02-architect-plan.md';

const temps = [];
after(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// A product with a plan body; `setting` is undefined (nothing stored), 'on' or 'off', stored in the user file.
function product(body, setting, where = 'user') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-optin-'));
  temps.push(base);
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  fs.cpSync(path.join(FIX, 'root'), root, { recursive: true });
  put(root, `${RUN}/${PLAN}`, `# Plan\n\n${body}\n`);
  put(root, `${RUN}/brief.md`, '# brief\n');
  put(root, `${RUN}/01-product-manager.md`, '# pm\n');
  put(root, `${RUN}/02-architect.md`, '# architect\n');
  put(root, '.company/standards.md', '# standards\n');
  put(root, 'docs/contracts/billing.md', '# Contract: billing v2.3\n');
  if (setting !== undefined) {
    const blob = JSON.stringify({ aico_settings: { version: 1, pipeline: { plan_review: setting } } });
    if (where === 'user') fs.writeFileSync(path.join(home, 'config.json'), blob);
    else put(root, '.company/settings.json', blob);
  }
  return { root, home };
}

const majors = ({ root, home }) => {
  const r = spawnSync(process.execPath, [SCRIPT, 'majors', 'demo', PLAN], { cwd: root, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const MAJOR = '- token-ledger v1.8 → v2.0';
const MINOR = '- token-ledger v1.7 → v1.8';
const SKIPPED = /skipped \(settings off\)/;

test('AC5: setting never stored (default off) and a plan with a Contract major prints skipped (settings off)', () => {
  const r = majors(product(MAJOR));
  assert.match(r.out, SKIPPED, r.out + r.err);
  assert.ok(!r.out.includes('contract major:'), 'no major line is printed while off');
  assert.ok([0, 4].includes(r.code), `a skip is not an error, got ${r.code}`);
});

test('AC5: plan_review stored off prints skipped (settings off)', () => {
  const r = majors(product(MAJOR, 'off'));
  assert.match(r.out, SKIPPED, r.out + r.err);
  assert.ok(!r.out.includes('contract major:'));
});

test('AC5: off also skips a plan with no major', () => {
  const r = majors(product(MINOR));
  assert.match(r.out, SKIPPED, r.out + r.err);
});

test('AC5: plan_review on at the user level keeps the old output: exit 0 and the major line', () => {
  const r = majors(product(MAJOR, 'on'));
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'contract major: line 3\n');
  assert.ok(!SKIPPED.test(r.out));
});

test('AC5: plan_review on at the project level keeps the old output too', () => {
  const r = majors(product(MAJOR, 'on', 'project'));
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'contract major: line 3\n');
});

test('AC5: on with no major keeps exit 4 and the not run line', () => {
  const r = majors(product(MINOR, 'on'));
  assert.equal(r.code, 4, r.out + r.err);
  assert.equal(r.out, 'plan review: not run (no Contract major)\n');
});

test('AC5: the skip does not hide a bad call: wrong arguments still exit 3 while off', () => {
  const p = product(MAJOR);
  const r = spawnSync(process.execPath, [SCRIPT, 'majors', 'demo'], { cwd: p.root, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: p.home } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
});

test('AC5: an invalid stored plan_review value counts as off', () => {
  const r = majors(product(MAJOR, 'maybe'));
  assert.match(r.out, SKIPPED, r.out + r.err);
});
