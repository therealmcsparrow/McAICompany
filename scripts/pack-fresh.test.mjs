import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packFresh } from './pack-fresh.mjs';

const script = path.join(import.meta.dirname, 'pack-fresh.mjs');
const TODAY = '2026-10-29';
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-fresh-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const dayStr = ago => new Date(Date.UTC(2026, 9, 29) - ago * 86400000).toISOString().slice(0, 10);
const packText = ({ tool = 'react', versions = '">=19 <20"', researched }) =>
  `---\ntool: ${tool}\nversions: ${versions}\nresearched: ${researched}\n---\n## Must\n- ${tool.slice(0, 5)}.M1 — a rule — source: https://example.com/x\n`;

// A project root with .company/standards.md and a pack, in a fresh temp dir.
function setup({ age = 10, name = 'react@19.md', versions, tool, listed = true, where = 'lib' } = {}) {
  const root = tmp();
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib);
  fs.mkdirSync(path.join(root, '.company', 'standards'), { recursive: true });
  const dir = where === 'lib' ? lib : path.join(root, '.company', 'standards');
  const pack = path.join(dir, name);
  fs.writeFileSync(pack, packText({ tool: tool ?? name.split('@')[0], versions, researched: dayStr(age) }));
  const std = path.join(root, '.company', 'standards.md');
  fs.writeFileSync(std, `# Ruleset\n## Packs\n${listed ? `- .company/standards/${name} — researched x\n` : '- .company/standards/other@1.md — x\n'}## Project rules\n- proj.M1 — x\n`);
  return { root, pack, std, dir };
}
const run = (s, o = {}) => packFresh({ pack: s.pack, version: '19.2', root: s.root, today: TODAY, ...o });

test('fresh pack inside versions is reuse', () => assert.equal(run(setup({ age: 10 })), 'reuse'));

test('age: 91 days is research age with new, with no use, wherever the file sits', () => {
  const s = setup({ age: 91 });
  assert.equal(run(s), 'research age');
  assert.equal(run(s, { use: 'new' }), 'research age');
  const c = setup({ age: 91, where: 'std' });
  assert.equal(run(c, { use: 'new', standards: c.std }), 'research age');
  assert.equal(run(c), 'research age');
});

test('age: repo use with the pack listed keeps 91 days, 181 days is research age', () => {
  const s = setup({ age: 91, where: 'std' });
  assert.equal(run(s, { use: 'repo', standards: s.std }), 'reuse');
  const old = setup({ age: 181, where: 'std' });
  assert.equal(run(old, { use: 'repo', standards: old.std }), 'research age');
  const edge = setup({ age: 180, where: 'std' });
  assert.equal(run(edge, { use: 'repo', standards: edge.std }), 'reuse');
});

test('age: repo use with the pack not listed gets the 90-day limit', () => {
  const s = setup({ age: 91, where: 'std', listed: false });
  assert.equal(run(s, { use: 'repo', standards: s.std }), 'research age');
});

test('age: repo use with any other standards file gets the 90-day limit', () => {
  const s = setup({ age: 91, where: 'std' });
  const copy = path.join(s.root, 'copy.md');
  fs.copyFileSync(s.std, copy);
  assert.equal(run(s, { use: 'repo', standards: copy }), 'research age');
  assert.equal(run(s, { use: 'repo', standards: path.join(s.root, 'lib', '..', 'copy.md') }), 'research age');
  assert.equal(run(s, { use: 'repo', standards: path.join(s.root, 'lib', '..', '.company', 'standards.md') }), 'reuse');
  assert.equal(run(s, { use: 'repo', standards: path.join(s.root, 'missing.md') }), 'research age');
  assert.equal(run(s, { use: 'repo' }), 'research age');
  assert.equal(run(s, { use: 'bogus', standards: s.std }), 'research age');
});

test('age: a standards.md that is a link or over the cap gets the 90-day limit', () => {
  const s = setup({ age: 91, where: 'std' });
  const real = path.join(s.root, 'real.md');
  fs.renameSync(s.std, real);
  let linked = true;
  try { fs.symlinkSync(real, s.std); } catch { linked = false; }
  if (linked) assert.equal(run(s, { use: 'repo', standards: s.std }), 'research age');
  fs.rmSync(s.std, { force: true });
  fs.writeFileSync(s.std, `## Packs\n- react@19.md\n${'x'.repeat(300 * 1024)}\n`);
  assert.equal(run(s, { use: 'repo', standards: s.std }), 'research age');
});

test('age: only a whole file name under ## Packs counts', () => {
  const s = setup({ age: 91, where: 'std' });
  fs.writeFileSync(s.std, '## Project rules\n- react@19.md\n## Packs\n- .company/standards/xreact@19.md — x\n- .company/standards/react@19.md.bak — x\n');
  assert.equal(run(s, { use: 'repo', standards: s.std }), 'research age');
});

test('version: missing, bad, out of range, major mismatch', () => {
  const s = setup();
  for (const v of [undefined, '', 'x', '19.', '19.1.2.3', '-19', '1234567', '19 ', '19\n', '19.2; rm', '1e1'])
    assert.equal(run(s, { version: v }), 'research version', String(v));
  assert.equal(run(s, { version: '20' }), 'research version');
  assert.equal(run(s, { version: '18.9' }), 'research version');
  assert.equal(run(s, { version: '19' }), 'reuse');
  assert.equal(run(s, { version: '19.99.9' }), 'reuse');
  const m = setup({ versions: '">=18 <21"' });
  assert.equal(run(m, { version: '20' }), 'research version');
});

test('version: a dated pack with free-text versions needs the whole number', () => {
  const free = setup({ name: 'wcag@2026.md', tool: 'wcag', versions: '"WCAG 2 and 3 as read 2026-10-20"' });
  assert.equal(run(free, { version: '2.2' }), 'reuse');
  assert.equal(run(free, { version: '3' }), 'reuse');
  assert.equal(run(free, { version: '4' }), 'research version');
  assert.equal(run(free, { version: '20' }), 'research version');
  assert.equal(run(free, { version: '10' }), 'research version');
  const dashed = setup({ name: 'wcag@2026.md', tool: 'wcag', versions: '"v2-1 and 1.2-3 and 5.0"' });
  for (const v of ['1', '2', '3', '5']) assert.equal(run(dashed, { version: v }), 'research version', v);
});

test('version: comparators are anchored and compared as numbers', () => {
  const g = setup({ name: 'git@2.md', tool: 'git', versions: '">=2.45 <3"' });
  assert.equal(run(g, { version: '2.45' }), 'reuse');
  assert.equal(run(g, { version: '2.9' }), 'research version');
  assert.equal(run(g, { version: '2.100' }), 'reuse');
  assert.equal(run(g, { version: '3.0' }), 'research version');
  const lt = setup({ versions: '">19 <=19.5"' });
  assert.equal(run(lt, { version: '19.5' }), 'reuse');
  assert.equal(run(lt, { version: '19' }), 'research version');
  assert.equal(run(lt, { version: '19.5.1' }), 'research version');
});

test('version: a long hostile versions line stays fast and is research', () => {
  const s = setup({ versions: `"${'>=1 '.repeat(5000)}!"` });
  const t = Date.now();
  assert.equal(run(s), 'research version');
  assert.ok(Date.now() - t < 1000);
});

test('advisory: one dated after researched is research advisory', () => {
  const s = setup({ age: 10 });
  fs.writeFileSync(path.join(s.dir, 'advisories.json'), JSON.stringify([{ tool: 'react', date: dayStr(5), id: 'CVE-1', source: 'https://example.com/a' }]));
  assert.equal(run(s), 'research advisory');
  fs.writeFileSync(path.join(s.dir, 'advisories.json'), JSON.stringify([{ tool: 'react', date: dayStr(10), id: 'CVE-1', source: 'https://example.com/a' }, { tool: 'other', date: dayStr(1), id: 'CVE-2', source: 'https://example.com/a' }]));
  assert.equal(run(s), 'reuse');
});

test('advisory: a missing file is no advisory; bad files are research advisory', () => {
  const s = setup();
  const f = path.join(s.dir, 'advisories.json');
  assert.equal(run(s), 'reuse');
  fs.writeFileSync(f, '{not json');
  assert.equal(run(s), 'research advisory');
  fs.writeFileSync(f, '{"tool":"react"}');
  assert.equal(run(s), 'research advisory');
  fs.writeFileSync(f, '[{"tool":"react","date":"soon","id":"x","source":"https://e.com"}]');
  assert.equal(run(s), 'research advisory');
  fs.writeFileSync(f, `[{"tool":"x","date":"2020-01-01","id":"${'a'.repeat(300 * 1024)}","source":"https://e.com"}]`);
  assert.equal(run(s), 'research advisory');
  fs.rmSync(f);
  fs.mkdirSync(f);
  assert.equal(run(s), 'research advisory');
  fs.rmdirSync(f);
  const real = path.join(s.root, 'real.json');
  fs.writeFileSync(real, '[]');
  let linked = true;
  try { fs.symlinkSync(real, f); } catch { linked = false; }
  if (linked) assert.equal(run(s), 'research advisory');
});

test('invalid: a pack that fails checkPack, is a link, or is missing', () => {
  const s = setup();
  fs.writeFileSync(s.pack, '---\ntool: react\nversions: "19"\nresearched: nope\n---\n## Must\n');
  assert.equal(run(s), 'research invalid');
  assert.equal(run(s, { version: 'bad' }), 'research invalid');
  assert.equal(run(s, { pack: path.join(s.root, 'nothing@1.md') }), 'research invalid');
  fs.writeFileSync(s.pack, packText({ researched: dayStr(-3) }));
  assert.equal(run(s), 'research invalid');
  fs.writeFileSync(s.pack, 'x'.repeat(300 * 1024));
  assert.equal(run(s), 'research invalid');
  const good = setup();
  const link = path.join(good.dir, 'react@20.md');
  let linked = true;
  try { fs.symlinkSync(good.pack, link); } catch { linked = false; }
  if (linked) assert.equal(run(good, { pack: link }), 'research invalid');
});

test('order: version before age before advisory', () => {
  const s = setup({ age: 200 });
  fs.writeFileSync(path.join(s.dir, 'advisories.json'), '{');
  assert.equal(run(s, { version: undefined }), 'research version');
  assert.equal(run(s), 'research age');
});

test('cli prints exactly one line', () => {
  const s = setup();
  const r = spawnSync(process.execPath, [script, s.pack, '--version', '19.2', '--root', s.root], { encoding: 'utf8' });
  assert.equal(r.stdout, 'reuse\n');
  const bad = spawnSync(process.execPath, [script, s.pack, '--root', s.root], { encoding: 'utf8' });
  assert.equal(bad.stdout, 'research version\n');
  const use = spawnSync(process.execPath, [script, s.pack, '--version', '19.2', '--use', 'repo', '--standards', s.std, '--root', s.root], { encoding: 'utf8' });
  assert.equal(use.stdout, 'reuse\n');
  const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});
