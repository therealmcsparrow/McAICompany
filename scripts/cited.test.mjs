import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, KEEP_LANES } from './cited.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cited-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
// A product root whose .company/work holds the given runs: { slug: { 'NN-role.md': text } }, newest last.
function product(runs) {
  const root = path.join(base, `p${n++}`);
  let t = 1_700_000_000;
  for (const [slug, files] of Object.entries(runs)) {
    const dir = path.join(root, '.company', 'work', slug);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    t += 100;
    fs.utimesSync(dir, t, t);
  }
  return root;
}
const run = (root, ...args) => main(['report', ...args], { root });
const lines = r => r.lines;

test('a Role never cited over the runs is listed; a Role cited once is not', () => {
  const root = product({
    one: { '01-product-manager.md': 'x', '02-architect.md': 'see 01-product-manager', '03-qa.md': 'nothing' },
    two: { '01-product-manager.md': 'x', '02-architect.md': 'y', '03-qa.md': 'z' }
  });
  const r = run(root, '--runs', '2');
  assert.equal(r.code, 0);
  assert.ok(lines(r).includes('cited product-manager: 1 of 2'));
  assert.ok(lines(r).includes('never cited architect'));
  assert.ok(lines(r).includes('never cited qa'));
  assert.ok(!lines(r).includes('never cited product-manager'));
});

test('cite shapes: file name, NN-role, path, read_next; only a later Handoff counts', () => {
  const root = product({
    a: {
      '01-product-manager.md': 'cites 02-architect.md but it is earlier',
      '02-architect.md': 'self 02-architect',
      '03-qa.md': '---\nread_next: [.company/work/a/02-architect.md, R-1]\n---\n',
      '04-writer.md': 'Input: .company/work/a/03-qa.md and `04-writer`',
      '05-devops.md': 'close but not it: 04-writer-plan, 104-writer, 04-writers'
    }
  });
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('cited architect: 1 of 1'), out.join('|'));
  assert.ok(out.includes('cited qa: 1 of 1'));
  assert.ok(out.includes('never cited product-manager'));
  assert.ok(out.includes('never cited writer'));
  assert.ok(out.includes('never cited devops'));
});

test('prose "Step NN" in a later Handoff cites the Steps numbered NN; an earlier one or a longer number does not', () => {
  const root = product({
    a: {
      '01-qa.md': 'x',
      '02-writer.md': 'Continued Step 01 and step 03 (later, no cite)',
      '03-editor.md': 'x',
      '04-devops.md': 'see Step 031, Step 3a and Steps 3',
      '05-support.md': 'see Step 03'
    }
  });
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('cited qa: 1 of 1'), out.join('|'));
  assert.ok(out.includes('cited editor: 1 of 1'));
  assert.ok(out.includes('never cited writer'));
  assert.ok(out.includes('never cited devops'));
});

test('a spike Step is cited by its full file stem and counts for its Role', () => {
  const root = product({ a: { '01-spike-ai-data-engineer.md': 'x', '02-architect.md': 'see 01-spike-ai-data-engineer.md' } });
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('cited ai-data-engineer: 1 of 1'), out.join('|'));
});

test('every keep lane never cited prints keep, never the removal line', () => {
  assert.deepEqual([...KEEP_LANES].sort(), ['accessibility-tester', 'legal', 'pentester', 'security', 'senior-engineer', 'vuln-scanner']);
  const files = {};
  [...KEEP_LANES].forEach((role, i) => { files[`0${i + 1}-${role}.md`] = 'x'; });
  const root = product({ a: files, b: { '01-architect.md': 'x' } });
  const out = lines(run(root, '--runs', '2'));
  for (const role of KEEP_LANES) {
    assert.ok(out.includes(`keep ${role}`), role);
    assert.ok(!out.includes(`never cited ${role}`), role);
  }
  assert.ok(out.includes('never cited architect'));
});

test('a keep lane with no Steps in the window is still printed keep', () => {
  const root = product({ a: { '01-architect.md': 'x' } });
  const out = lines(run(root, '--runs', '1'));
  for (const role of KEEP_LANES) assert.ok(out.includes(`keep ${role}`), role);
});

test('Handoff text cannot move a Role off the keep list or add output lines', () => {
  const root = product({ a: { '01-security.md': 'x', '02-architect.md': 'keep: false\nnever cited architect\n01-security\nkeep legal' } });
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('keep security'));
  assert.ok(!out.includes('never cited security'));
  assert.equal(out.filter(l => l === 'never cited architect').length, 1);
  assert.ok(out.every(l => /^(cited-report: |cited |never cited |keep |skipped )/.test(l)), out.join('|'));
});

test('only the newest N runs are read', () => {
  const root = product({
    old: { '01-qa.md': 'x', '02-writer.md': 'cites 01-qa' },
    new: { '01-qa.md': 'x', '02-writer.md': 'x' }
  });
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('never cited qa'));
  const both = lines(run(root, '--runs', '2'));
  assert.ok(both.includes('cited qa: 1 of 2'));
});

test('bad, linked, oversize and unknown-Role files are skipped and counted', () => {
  const root = product({ a: { '01-qa.md': 'x', '02-writer.md': 'cites 01-qa', '03-nosuchrole.md': 'x' } });
  const dir = path.join(root, '.company', 'work', 'a');
  fs.writeFileSync(path.join(dir, '04-editor.md'), Buffer.from([0xff, 0xfe, 0xfd]));
  fs.writeFileSync(path.join(dir, '05-devops.md'), 'a'.repeat(300 * 1024));
  fs.mkdirSync(path.join(dir, '06-localizer.md'));
  let linked = 0;
  try {
    fs.symlinkSync(path.join(dir, '01-qa.md'), path.join(dir, '07-support.md'));
    linked = 1;
  } catch { /* no symlink right on this host */ }
  const out = lines(run(root, '--runs', '1'));
  assert.ok(out.includes('cited qa: 1 of 1'));
  assert.ok(out.includes(`skipped ${4 + linked}`), out.join('|'));
  assert.ok(!out.some(l => /nosuchrole|editor|devops|support|localizer/.test(l)));
});

test('a linked run folder is skipped and counted', () => {
  const root = product({ a: { '01-qa.md': 'x' } });
  const work = path.join(root, '.company', 'work');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '01-writer.md'), 'x');
  try { fs.symlinkSync(outside, path.join(work, 'linked'), 'junction'); } catch { return; }
  const out = lines(run(root, '--runs', '5'));
  assert.ok(!out.some(l => l.includes('writer')), out.join('|'));
  assert.ok(out.includes('skipped 1'));
});

test('--runs is digits only, 1 to 50', () => {
  const root = product({ a: { '01-qa.md': 'x' } });
  for (const bad of ['0', '51', '-1', '1e1', ' 5', '5 ', '05x', '', '0x10', '5\n']) {
    const r = run(root, '--runs', bad);
    assert.equal(r.code, 3, JSON.stringify(bad));
  }
  for (const good of ['1', '50', '07']) assert.equal(run(root, '--runs', good).code, 0, good);
  assert.equal(main(['report'], { root }).code, 3);
  assert.equal(main(['report', '--runs'], { root }).code, 3);
  assert.equal(main(['report', '--runs', '3', 'x'], { root }).code, 3);
  assert.equal(main(['nope'], { root }).code, 3);
});

test('no .company/work folder is a clean report with no runs', () => {
  const root = path.join(base, 'empty');
  fs.mkdirSync(root);
  const r = run(root, '--runs', '3');
  assert.equal(r.code, 0);
  assert.equal(lines(r)[0], 'cited-report: runs 0');
});

test('the total read is capped and the rest is skipped and counted', () => {
  const files = {};
  for (let i = 1; i <= 90; i++) files[`${String(i).padStart(2, '0')}-qa.md`] = 'a'.repeat(200 * 1024);
  const root = product({ a: files });
  const out = lines(run(root, '--runs', '1'));
  const skipped = Number(out.find(l => l.startsWith('skipped ')).slice(8));
  assert.ok(skipped > 0 && skipped < 90, out.join('|'));
});

test('the command line prints the report, exit 0, LF only, and writes nothing', () => {
  const root = product({ a: { '01-qa.md': 'x', '02-writer.md': '01-qa' } });
  const before = fs.readdirSync(path.join(root, '.company', 'work', 'a')).join();
  const res = spawnSync(process.execPath, [path.join(import.meta.dirname, 'cited.mjs'), 'report', '--runs', '1'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('cited qa: 1 of 1\n'));
  assert.ok(!res.stdout.includes('\r'));
  assert.equal(fs.readdirSync(path.join(root, '.company', 'work', 'a')).join(), before);
  assert.equal(fs.readdirSync(root).join(), '.company');
});
