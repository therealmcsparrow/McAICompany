// Work folder names in the run guard, skill picks, drift report and skillspector report.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as guardMain } from './run-guard.mjs';
import { lint as picksLint, Refused } from './skill-picks.mjs';
import { main as driftMain } from './drift-report.mjs';
import { writeReport, renderReport, main as spectorMain, NAME_RE } from './skillspector.mjs';

const NEW = '2026-10-30 22.42 - Misc Check';
const HELPER = '2026-10-30 22.42 - Misc Check Draft 2';
const LEGACY = 'misc-demo';
const HOSTILE = [
  '2026-10-30 22.42 - misc check',
  '2026-10-30 22.42 - Misc Check ',
  '2026-10-30 22.42 - Misc/../Check',
  '2026-10-30 22.42 - Misc\\Check',
  '2026-10-30 22.42 - Misc Check Build 2',
  '2026-10-30 22.42 - Misc$(id)',
  "2026-10-30 22.42 - Misc'Check",
  '2026-13-30 22.42 - Misc Check',
  '..',
  '../escape',
  '/etc',
  '',
];
const PROBE = '2026-10-30 22.42 - Misc `touch pwned`';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-misc-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
process.env.MCSPARROW_HOME = path.join(base, 'home');

let n = 0;
function project(folders = [NEW, HELPER, LEGACY]) {
  const root = path.join(base, `p${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  for (const f of folders) fs.mkdirSync(path.join(root, '.company', 'work', f), { recursive: true });
  return root;
}
const put = (root, folder, file, text) => fs.writeFileSync(path.join(root, '.company', 'work', folder, file), text);

describe('run-guard', () => {
  for (const name of [NEW, HELPER, LEGACY]) {
    test(`gate accepts ${name}`, () => {
      const r = guardMain(['gate', name], { root: project() });
      assert.equal(r.code, 0);
      assert.equal(r.lines.length, 2);
      assert.match(r.lines[1], /^guardrail handover: \d+ of \d+ Steps$/);
    });
  }
  for (const bad of HOSTILE.concat(PROBE)) {
    test(`gate refuses ${JSON.stringify(bad)} without echo`, () => {
      const r = guardMain(['gate', bad], { root: project() });
      assert.equal(r.code, 3);
      assert.equal(r.lines.length, 1);
      assert.match(r.lines[0], /^refused: [a-z ]+$/);
      assert.ok(!r.lines[0].includes('Misc'));
    });
  }
  test('gate refuses a wrong argument count', () => {
    assert.equal(guardMain(['gate'], { root: project() }).code, 3);
    assert.equal(guardMain(['gate', NEW, NEW], { root: project() }).code, 3);
  });
});

describe('skill-picks', () => {
  const HANDOFF = ['---', 'area: stack', '---', '## Recommended set', '- (none: no candidate passed vetting)', ''].join('\n');
  for (const name of [NEW, HELPER, LEGACY]) {
    test(`lint accepts a handoff under ${name}`, () => {
      const root = project();
      put(root, name, '03-skill-researcher.md', HANDOFF);
      const r = picksLint(`.company/work/${name}/03-skill-researcher.md`, new Date(2026, 9, 31), root);
      assert.equal(r.area, 'stack');
      assert.deepEqual(r.picks, []);
    });
  }
  for (const bad of HOSTILE.filter((h) => h !== '').concat(PROBE)) {
    test(`lint refuses folder ${JSON.stringify(bad)} without echo`, () => {
      const root = project();
      assert.throws(
        () => picksLint(`.company/work/${bad}/03-skill-researcher.md`, new Date(2026, 9, 31), root),
        (e) => e instanceof Refused && /^handoff path must be/.test(e.message) && !e.message.includes('Misc'),
      );
    });
  }
  test('lint refuses a deeper path, a bad file name and an oversize argument', () => {
    const root = project();
    for (const arg of [
      `.company/work/${NEW}/sub/03-skill-researcher.md`,
      `.company/work/${NEW}/3-skill-researcher.md`,
      `.company/work/${NEW}/03-skill-researcher.md `,
      `.company/work/${'a'.repeat(5000)}/03-skill-researcher.md`,
      `.company/work//03-skill-researcher.md`,
    ]) {
      assert.throws(() => picksLint(arg, new Date(2026, 9, 31), root), Refused);
    }
  });
  test('skill names keep their own allow-list, not the work folder grammar', () => {
    assert.ok(NAME_RE.test('my-skill'));
    assert.ok(!NAME_RE.test(NEW));
    assert.ok(!NAME_RE.test('My Skill'));
  });
});

describe('drift-report', () => {
  const REPORT = ['---', 'checked: [misc]', 'date: 2026-10-30', '---', '## Items', '- none', ''].join('\n');
  function withContract() {
    const root = project();
    fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'contracts', 'misc.md'), '# Contract: misc v1\n\nProvider: `scripts/misc.mjs` (Node built-ins only).\n');
    fs.writeFileSync(path.join(root, 'scripts', 'misc.mjs'), '// misc\n');
    return root;
  }
  for (const name of [NEW, HELPER, LEGACY]) {
    test(`lint reads a report under ${name}`, () => {
      const root = withContract();
      put(root, name, 'drift-2026-10-30.md', REPORT);
      const r = driftMain(['lint', `.company/work/${name}/drift-2026-10-30.md`], { root });
      assert.equal(r.code, 0, r.lines.join('\n'));
      assert.equal(r.lines.at(-1), 'drift-report: 0 errors');
    });
    test(`pick reads reports under ${name}`, () => {
      const root = withContract();
      put(root, name, 'drift-2026-10-30.md', REPORT);
      const r = driftMain(['pick'], { root });
      assert.equal(r.code, 0);
      assert.match(r.lines[0], / 2026-10-30$/);
    });
  }
  test('pick ignores reports under a name that is not a work folder', () => {
    const root = withContract();
    const odd = '2026-10-30 22.42 - misc lower';
    fs.mkdirSync(path.join(root, '.company', 'work', odd));
    put(root, odd, 'drift-2026-10-30.md', REPORT);
    const r = driftMain(['pick'], { root });
    assert.match(r.lines[0], / never$/);
  });
  for (const bad of HOSTILE.filter((h) => h !== '').concat(PROBE)) {
    test(`lint refuses folder ${JSON.stringify(bad)} without echo`, () => {
      const root = project();
      const r = driftMain(['lint', `.company/work/${bad}/drift-2026-10-30.md`], { root });
      assert.equal(r.code, 3);
      assert.match(r.lines[0], /^refused: report must be \.company\/work\/<work folder>\/drift-<YYYY-MM-DD>\.md$/);
    });
  }
  test('lint refuses a deeper path and an oversize argument', () => {
    const root = project();
    assert.equal(driftMain(['lint', `.company/work/${NEW}/x/drift-2026-10-30.md`], { root }).code, 3);
    assert.equal(driftMain(['lint', `.company/work/${'a'.repeat(400)}/drift-2026-10-30.md`], { root }).code, 3);
  });
});

describe('skillspector report', () => {
  const OUT = { v: 1, tool: { version: '2.13.1', commit: null }, mode: 'no-llm', results: [], summary: { pass: 0, findings: 0, error: 0 } };
  for (const name of [NEW, HELPER, LEGACY]) {
    test(`writeReport writes under ${name}`, async () => {
      const root = project([]);
      const file = await writeReport(root, name, OUT);
      assert.equal(file, path.join(root, '.company', 'work', name, 'skillspector-report.md'));
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.startsWith('# SkillSpector scan'));
      assert.ok(!text.includes('\r'));
      assert.ok(renderReport(OUT, {}).startsWith('# SkillSpector scan'));
    });
  }
  for (const bad of HOSTILE.concat(PROBE)) {
    test(`writeReport refuses ${JSON.stringify(bad)} and writes nothing`, async () => {
      const root = project([]);
      await assert.rejects(() => writeReport(root, bad, OUT), /bad report slug/);
      assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work')), []);
    });
    test(`scan --report refuses ${JSON.stringify(bad)} before any scan`, async () => {
      await assert.rejects(
        () => spectorMain(['scan', '--scope', 'project', '--report', bad, '--json'], {}),
        (e) => /bad report slug/.test(e.message) && !e.message.includes('Misc'),
      );
    });
  }
});
