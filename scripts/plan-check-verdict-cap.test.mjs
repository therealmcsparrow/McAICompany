import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, verdict } from './plan-check-verdict.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-check-verdict-cap-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
process.env.GIT_CEILING_DIRECTORIES = base;

const put = (root, rel, text, iso) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  if (iso) { const t = new Date(iso); fs.utimesSync(f, t, t); }
};
const stepText = `---\nstep: 03\nrole: backend-engineer\ntask: x\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: medium\n---\n## Did\n`;

// 205 plain v2 folders s000..s204 (no git, so ordering is by file time). The two lowest names are the newest runs.
function tree() {
  const root = path.join(base, 'cap');
  for (let i = 0; i < 205; i++) {
    const slug = `s${String(i).padStart(3, '0')}`;
    const dir = `.company/work/${slug}`;
    const newest = i < 2;
    put(root, `${dir}/00-summary.md`, '# done\n', newest ? '2026-10-20T10:00:00Z' : `2026-10-10T10:00:${String(i % 60).padStart(2, '0')}Z`);
    put(root, `${dir}/02-plan.md`, '# Plan\n');
    if (newest) {
      put(root, `${dir}/03-backend-engineer.md`, stepText, '2026-10-20T10:00:00Z');
      put(root, `${dir}/run-state.jsonl`, [
        { v: 1, at: '2026-10-20T08:00:00Z', ev: 'start' },
        { v: 1, at: '2026-10-20T12:00:00Z', ev: 'gate', gate: 'ship', result: 'passed' }
      ].map(o => JSON.stringify(o)).join('\n') + '\n');
      put(root, `.company/ledger/${slug}.jsonl`, `${JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: 0 })}\n`);
    }
  }
  return root;
}

test('verdict: walks every folder, so the newest runs count even with a low name past 200 folders', () => {
  const r = verdict(tree(), 3);
  assert.deepEqual(r.runs.base.map(x => x.slug).sort(), ['s000', 's001']);
});

test('history: working-tree plans are the first 200 folders by name, as before', () => {
  const r = main(['history', '--limit', '200', '--json'], { root: tree() });
  const paths = JSON.parse(r.lines[0]).plans.map(p => p.path);
  assert.equal(paths.length, 200);
  assert.ok(paths.includes('.company/work/s000/02-plan.md'));
  assert.ok(!paths.includes('.company/work/s204/02-plan.md'));
});
