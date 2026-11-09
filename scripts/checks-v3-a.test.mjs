// QA-first tests for T35 (AC22, part a): cited-report, drift-report, slop-scan and skillspector-scan on a v3 run slug
// (`<ProjectID>/<NN>-<playbook>`) must behave as they do on a v2 folder. Contract delta: cited-report v1.2 -> v1.3,
// drift-report v1.2 -> v1.3, slop-scan v1 -> v1.1, skillspector-scan v1.3 -> v1.4 (Reader rule: run-state v2.0 /
// work-folder-name v3.0 helpers, no hand-rolled reverse). Each test builds the same content under a v2 name and a v3 slug
// and compares the output; v2 behaviour is the oracle.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main as citedMain } from './cited.mjs';
import { main as driftMain } from './drift-report.mjs';
import { main as slopMain } from './slop-scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');
const SKILLSPECTOR = path.join(HERE, 'skillspector.mjs');

const V2 = 'P20261109.000001-10.00.00';
const PID = 'P20261109.000002';
const V3 = `${PID}/01-feature`;
const V3B = `${PID}/02-fix`;

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const tmp = (p) => { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); roots.push(r); return r; };
const put = (root, rel, text) => {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
};
const slugDir = (root, slug) => path.join(root, '.company', 'work', ...slug.split('/'));
const stamp = (root, slug, t) => fs.utimesSync(slugDir(root, slug), t, t);
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const head = (file, n = 5) => fs.readFileSync(path.join(PLUGIN, file), 'utf8').split('\n').slice(0, n).join('\n');

// ---------- contract versions (T35 flips each doc and its provider's cite together) ----------
describe('contract versions and the Reader rule paragraph', () => {
  const cases = [
    ['cited-report', 'scripts/cited.mjs', '1.3'],
    ['drift-report', 'scripts/drift-report.mjs', '1.3'],
    ['slop-scan', 'scripts/slop-scan.mjs', '1.1'],
    ['skillspector-scan', 'scripts/skillspector.mjs', '1.4'],
  ];
  for (const [name, script, v] of cases) {
    test(`AC22 ${name} doc header is v${v}`, () => {
      assert.match(head(`docs/contracts/${name}.md`, 1), new RegExp(`^# Contract: ${name} v${v.replace('.', '\\.')}$`));
    });
    test(`AC22 ${script} cites ${name} v${v} in its first lines`, () => {
      assert.match(head(script), new RegExp(`docs/contracts/${name}\\.md v${v.replace('.', '\\.')}(?![0-9])`));
    });
    test(`AC22 ${name} doc has a v${v} paragraph saying v2, v1.1 and legacy output is byte-identical`, () => {
      const text = fs.readFileSync(path.join(PLUGIN, 'docs', 'contracts', `${name}.md`), 'utf8');
      const para = text.split(/\n\n/).find((p) => p.startsWith(`v${v} `) || p.startsWith(`v${v}:`) || p.startsWith(`v${v} (`));
      assert.ok(para, `no paragraph starting v${v}`);
      assert.match(para, /byte-identical/);
      assert.match(para, /<ProjectID>\/<NN>-<playbook>|v3/);
    });
  }
});

// ---------- cited-report ----------
describe('cited-report on v3 runs', () => {
  const files = {
    '01-product-manager.md': 'x',
    '02-architect.md': 'see 01-product-manager',
    '03-qa.md': 'nothing',
  };
  const build = (slug) => {
    const root = tmp('checks-cited-');
    for (const [n, text] of Object.entries(files)) put(root, `.company/work/${slug}/${n}`, text);
    if (slug.includes('/')) put(root, `.company/work/${slug.split('/')[0]}/00-project.md`, 'A project\n');
    stamp(root, slug, 1_700_000_100);
    return root;
  };
  const report = (root, n = '5') => citedMain(['report', '--runs', n], { root });

  test('AC22 a v3 run gives the same report lines as the same Steps in a v2 folder', () => {
    const a = report(build(V2));
    const b = report(build(V3));
    assert.equal(a.code, 0);
    assert.ok(a.lines.includes('cited-report: runs 1'));
    assert.deepEqual(b, a);
  });

  test('AC22 runs counts v3 runs, not project folders; --runs limits runs, newest first', () => {
    const root = build(V3);
    put(root, `.company/work/${V3B}/01-product-manager.md`, 'x');
    put(root, `.company/work/${V3B}/02-architect.md`, 'y');
    put(root, `.company/work/${V2}/01-product-manager.md`, 'x');
    stamp(root, V3, 1_700_000_100);
    stamp(root, V3B, 1_700_000_300);
    stamp(root, V2, 1_700_000_200);
    assert.equal(report(root, '5').lines[0], 'cited-report: runs 3');
    // the two newest runs are V3B and V2; V3 (the only run with a cite) is cut off
    const two = report(root, '2');
    assert.equal(two.lines[0], 'cited-report: runs 2');
    assert.ok(!two.lines.some((l) => l.startsWith('cited ')), two.lines.join('\n'));
  });

  test('AC22 a v3 project folder with no Step files in the project folder itself adds no run', () => {
    const root = tmp('checks-cited-');
    put(root, `.company/work/${PID}/00-project.md`, 'A project\n');
    put(root, `.company/work/${PID}/01-product-manager.md`, 'a stray file in the project folder');
    assert.equal(report(root).lines[0], 'cited-report: runs 0');
  });
});

// ---------- drift-report ----------
describe('drift-report on v3 runs', () => {
  const body = '---\nchecked: [c01]\ndate: 2026-03-01\n---\n## Items\n- none\n';
  const fixture = (slug) => {
    const root = tmp('checks-drift-');
    for (const n of ['c01', 'c02']) {
      put(root, `docs/contracts/${n}.md`, `# Contract: ${n} v1\n\nProvider: \`scripts/${n}.mjs\` (Node built-ins only).\n`);
      put(root, `scripts/${n}.mjs`, '// provider\n');
    }
    put(root, `.company/work/${slug}/drift-2026-03-01.md`, body);
    return root;
  };
  const run = (root, ...args) => driftMain(args, { root });

  test('AC22 lint of a report in a v3 run folder gives the v2 result', () => {
    const a = run(fixture(V2), 'lint', `.company/work/${V2}/drift-2026-03-01.md`);
    const b = run(fixture(V3), 'lint', `.company/work/${V3}/drift-2026-03-01.md`);
    assert.deepEqual(a, { code: 0, lines: ['drift-report: 0 errors'] });
    assert.deepEqual(b, a);
  });

  test('AC22 lint of a v3 report with a bad body reports the same errors as v2', () => {
    const bad = '---\nchecked: [c01]\ndate: 2026-03-01\n---\n## Items\n- none\n- another\n';
    const r2 = fixture(V2);
    const r3 = fixture(V3);
    put(r2, `.company/work/${V2}/drift-2026-03-01.md`, bad);
    put(r3, `.company/work/${V3}/drift-2026-03-01.md`, bad);
    const a = run(r2, 'lint', `.company/work/${V2}/drift-2026-03-01.md`);
    const b = run(r3, 'lint', `.company/work/${V3}/drift-2026-03-01.md`);
    assert.equal(a.code, 2);
    assert.deepEqual(b, a);
  });

  test('AC22 lint accepts the absolute path of a v3 report', () => {
    const root = fixture(V3);
    const r = run(root, 'lint', path.join(root, '.company', 'work', ...V3.split('/'), 'drift-2026-03-01.md'));
    assert.deepEqual(r, { code: 0, lines: ['drift-report: 0 errors'] });
  });

  test('AC22 pick counts a check recorded in a v3 run: c01 is no longer never-checked', () => {
    const r = run(fixture(V3), 'pick');
    assert.equal(r.code, 0);
    const names = r.lines.filter((l) => !l.startsWith('pick:')).map((l) => l.split(' ')[0]);
    assert.deepEqual(names, ['c02', 'c01']);
    assert.ok(r.lines.some((l) => l.startsWith('c01 ') && l.endsWith(' 2026-03-01')), r.lines.join('\n'));
  });

  test('AC22 pick gives the same lines for a v3 report as for a v2 report', () => {
    assert.deepEqual(run(fixture(V3), 'pick'), run(fixture(V2), 'pick'));
  });

  test('AC22 a traversal or a report in the project folder itself is still refused', () => {
    const root = fixture(V3);
    for (const rel of [`.company/work/${PID}/../${V3}/drift-2026-03-01.md`, `.company/work/${PID}/drift-2026-03-01.md`,
      `.company/work/${PID}/01-feature/x/drift-2026-03-01.md`]) {
      const r = run(root, 'lint', rel);
      assert.notEqual(r.code, 0, rel);
    }
  });
});

// ---------- slop-scan ----------
describe('slop-scan on v3 runs', () => {
  const text = 'This is a plain note about the run.\n\nIt has two paragraphs.\n';
  const scanOf = (slug, file = '00-summary.md') => {
    const root = tmp('checks-slop-');
    put(root, `.company/work/${slug}/${file}`, text);
    return { root, res: slopMain(['--json', `.company/work/${slug}/${file}`], { cwd: root }) };
  };
  const strip = (s, slug) => s.split(`.company/work/${slug}/`).join('<run>/');

  test('AC22 a file in a v3 run folder scans as the same file in a v2 folder', () => {
    const a = scanOf(V2);
    const b = scanOf(V3);
    assert.equal(a.res.code, 0);
    assert.equal(b.res.code, 0, b.res.stderr);
    assert.equal(strip(b.res.stdout, V3), strip(a.res.stdout, V2));
    assert.equal(b.res.stderr, '');
  });

  test('AC22 a v3 run folder given as a directory is walked as a v2 folder is', () => {
    const a = tmp('checks-slop-');
    const b = tmp('checks-slop-');
    put(a, `.company/work/${V2}/00-summary.md`, text);
    put(b, `.company/work/${V3}/00-summary.md`, text);
    const ra = slopMain(['--json', `.company/work/${V2}`], { cwd: a });
    const rb = slopMain(['--json', `.company/work/${V3}`], { cwd: b });
    assert.equal(ra.code, 0);
    assert.equal(rb.code, 0, rb.stderr);
    assert.equal(strip(rb.stdout, V3), strip(ra.stdout, V2));
  });

  test('AC22 a v3 path typed in another letter case is refused as a missing file, like v2', () => {
    const root = tmp('checks-slop-');
    put(root, `.company/work/${V3}/00-summary.md`, text);
    const wrong = slopMain(['--json', `.company/work/${PID}/01-FEATURE/00-summary.md`], { cwd: root });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /missing/);
  });
});

// ---------- skillspector-scan ----------
describe('skillspector-scan report on a v3 slug', () => {
  const output = { v: 1, tool: { version: '2.13.1', commit: null }, mode: 'no-llm', results: [], skipped_invalid: 0, summary: { pass: 0, findings: 0, error: 0 } };
  const opts = { date: new Date('2026-10-26T10:00:00Z') };
  const mod = () => import(pathToFileURL(SKILLSPECTOR).href);

  test('AC22 writeReport to a v3 slug writes the v2 bytes at <ID>/<NN>-<pb>/skillspector-report.md and nothing else', async () => {
    const { writeReport } = await mod();
    const r2 = tmp('checks-ss-');
    const r3 = tmp('checks-ss-');
    await writeReport(r2, V2, output, opts);
    const file = await writeReport(r3, V3, output, opts);
    assert.equal(path.resolve(file), path.join(r3, '.company', 'work', PID, '01-feature', 'skillspector-report.md'));
    assert.equal(read(r3, `.company/work/${V3}/skillspector-report.md`), read(r2, `.company/work/${V2}/skillspector-report.md`));
    assert.deepEqual(fs.readdirSync(slugDir(r3, V3)), ['skillspector-report.md'], 'no temp file left behind');
  });

  test('AC22 a v3 slug whose project folder exists writes into the existing run folder', async () => {
    const { writeReport } = await mod();
    const root = tmp('checks-ss-');
    put(root, `.company/work/${PID}/00-project.md`, 'A project\n');
    put(root, `.company/work/${V3}/00-summary.md`, 'summary\n');
    await writeReport(root, V3, output, opts);
    assert.deepEqual(fs.readdirSync(slugDir(root, V3)).sort(), ['00-summary.md', 'skillspector-report.md']);
    assert.equal(read(root, `.company/work/${PID}/00-project.md`), 'A project\n');
  });

  test('AC22 a v3 project folder that is a link is refused as a link and nothing is written through it', async (t) => {
    const { writeReport } = await mod();
    const root = tmp('checks-ss-');
    const target = tmp('checks-ss-target-');
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    try { fs.symlinkSync(target, path.join(root, '.company', 'work', PID), 'junction'); } catch (e) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) return t.skip('links unavailable here');
      throw e;
    }
    await assert.rejects(() => writeReport(root, V3, output, opts), /link/);
    assert.deepEqual(fs.readdirSync(target), []);
  });

  test('AC22 a bad v3 slug (traversal, second slash, project ID alone with a run part missing) is still refused', async () => {
    const { writeReport } = await mod();
    const root = tmp('checks-ss-');
    for (const bad of [`${PID}/../x`, `${PID}/01-feature/x`, `${PID}\\01-feature`, `${PID}/1-feature`]) {
      await assert.rejects(() => writeReport(root, bad, output, opts), /bad report slug/, bad);
    }
    assert.ok(!fs.existsSync(path.join(root, '.company')));
  });

  test('AC22 scan --report <v3 slug> passes slug validation (with the tool missing it reaches "skillspector missing")', () => {
    const base = tmp('checks-ss-cli-');
    const project = path.join(base, 'project');
    const emptyBin = path.join(base, 'bin');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(emptyBin);
    const env = { ...process.env, HOME: base, USERPROFILE: base, PATH: emptyBin };
    const run = (slug) => spawnSync(process.execPath, [SKILLSPECTOR, 'scan', '--scope', 'project', '--report', slug, '--json'],
      { cwd: project, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    const v2 = run(V2);
    const v3 = run(V3);
    assert.match(v2.stdout, /^refused: skillspector missing/);
    assert.equal(v3.status, v2.status);
    assert.equal(v3.stdout, v2.stdout);
    assert.ok(!fs.existsSync(path.join(project, '.company')));
  });
});
