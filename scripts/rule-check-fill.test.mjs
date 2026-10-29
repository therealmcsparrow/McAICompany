import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './rule-check.mjs';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const __mkdtemp = fs.mkdtempSync;
const __rmTree = fs.rmSync;
fs.mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const made = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-check-fill-'));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const HEAD = '## Security rows (filled by rule-check)';
const S1 = '- fx.M-SEC1 — first security rule — why: w — source: https://example.test/a';
const S2 = '- fx.M-SEC2 — second security rule — why: w — source: https://example.test/b';
const PACK = `---\ntool: fx\n---\n## Must\n- fx.M1 — plain must — source: x\n${S1}\n## Should\n- fx.S1 — should — source: x\n## Security\n${S2}\n- fx.M3 — not security — source: x\n`;

function fixture({ standards, packs = { 'fx@1.md': PACK }, extra = {} } = {}) {
  const dir = tmp();
  const packDir = path.join(dir, 'packs');
  fs.mkdirSync(packDir);
  for (const [name, text] of Object.entries({ ...packs, ...extra })) fs.writeFileSync(path.join(packDir, name), text);
  const file = path.join(dir, 'standards.md');
  const listed = Object.keys(packs).map(n => `- .company/standards/${n} — researched 2026-10-29`).join('\n');
  fs.writeFileSync(file, standards ?? `library: x\n## Packs\n${listed}\n## Project rules\n- proj.M1 — own rule\n## Exceptions\n## Debt\n`);
  return { dir, packDir, file };
}
const fill = f => main(['fill-security', f.file, '--packs', f.packDir]);
const read = f => fs.readFileSync(f.file, 'utf8');
const added = r => r.lines.filter(l => l.startsWith('added '));

test('appends both missing security rows under the marker and reports them', () => {
  const f = fixture();
  const before = read(f);
  const r = fill(f);
  assert.equal(r.code, 0);
  assert.deepEqual(added(r), ['added fx.M-SEC1', 'added fx.M-SEC2']);
  const after = read(f);
  assert.ok(after.endsWith(`\n${HEAD}\n${S1}\n${S2}\n`));
  assert.ok(after.startsWith(before));
  assert.ok(!after.includes('plain must'));
  assert.ok(!after.includes('fx.M3'));
  assert.ok(!after.includes('\r'));
});

test('a second run adds nothing and leaves the file as it is', () => {
  const f = fixture();
  fill(f);
  const once = read(f);
  const r = fill(f);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['nothing to add']);
  assert.equal(read(f), once);
});

test('rows are added into an existing marker section that is not last', () => {
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n${HEAD}\n${S1}\n## Debt\nx\n` });
  const r = fill(f);
  assert.deepEqual(r.lines, ['added fx.M-SEC2']);
  assert.equal(read(f), `## Packs\n- .company/standards/fx@1.md — r\n${HEAD}\n${S1}\n${S2}\n## Debt\nx\n`);
});

test('an id only in Debt, Exceptions or prose still counts as missing', () => {
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n## Project rules\nmentions fx.M-SEC1 in prose\n## Exceptions\n- fx.M-SEC1 — scope — reason — approved: x (CEO)\n## Debt\n- fx.M-SEC2 — a.js:1 — S\n` });
  assert.deepEqual(added(fill(f)), ['added fx.M-SEC1', 'added fx.M-SEC2']);
});

test('a rule already under Project rules is not added', () => {
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n## Project rules\n${S1}\n` });
  assert.deepEqual(fill(f).lines, ['added fx.M-SEC2']);
});

test('a pack not listed under Packs is not read', () => {
  const f = fixture({ extra: { 'other@1.md': PACK.replaceAll('fx.', 'ot.') } });
  const r = fill(f);
  assert.ok(!read(f).includes('ot.M-SEC'));
  assert.ok(!r.lines.some(l => l.includes('ot.')));
});

test('a listed path is reduced to its file name', () => {
  const f = fixture({ standards: '## Packs\n- ../../etc/fx@1.md — r\n' });
  const r = fill(f);
  assert.equal(r.code, 0);
  assert.ok(read(f).includes('fx.M-SEC1'));
});

test('a listed pack that is a link is not read', (t) => {
  const f = fixture({ packs: {} });
  const real = path.join(f.dir, 'real.md');
  fs.writeFileSync(real, PACK);
  try {
    fs.symlinkSync(real, path.join(f.packDir, 'fx@1.md'));
  } catch {
    t.skip('symlinks not available');
    return;
  }
  fs.writeFileSync(f.file, '## Packs\n- .company/standards/fx@1.md — r\n');
  const r = fill(f);
  assert.equal(r.code, 0);
  assert.ok(!read(f).includes('fx.M-SEC'));
  assert.ok(r.lines.some(l => l.startsWith('pack not read fx@1.md')));
});

test('a listed pack that is a folder or missing is not read', () => {
  const f = fixture({ packs: {} });
  fs.mkdirSync(path.join(f.packDir, 'fx@1.md'));
  fs.writeFileSync(f.file, '## Packs\n- .company/standards/fx@1.md — r\n- .company/standards/gone@1.md — r\n');
  const r = fill(f);
  assert.equal(r.code, 0);
  assert.equal(r.lines.filter(l => l.startsWith('pack not read')).length, 2);
});

test('a standards.md that is a link is refused and nothing is written', (t) => {
  const f = fixture();
  const real = path.join(f.dir, 'real-standards.md');
  fs.renameSync(f.file, real);
  try {
    fs.symlinkSync(real, f.file);
  } catch {
    t.skip('symlinks not available');
    return;
  }
  const before = fs.readFileSync(real, 'utf8');
  const r = fill(f);
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /^refused: /);
  assert.equal(fs.readFileSync(real, 'utf8'), before);
});

test('a standards.md over the cap, or not a file, is refused', () => {
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n${'x'.repeat(256 * 1024)}\n` });
  const r = fill(f);
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /^refused: /);
  assert.ok(!read(f).includes('fx.M-SEC'));
  assert.equal(main(['fill-security', f.dir, '--packs', f.packDir]).code, 2);
  assert.equal(main(['fill-security', path.join(f.dir, 'nope.md'), '--packs', f.packDir]).code, 2);
});

test('an append that would pass the cap is refused whole', () => {
  const pad = 'x'.repeat(256 * 1024 - 120);
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n${pad}\n` });
  const before = read(f);
  const r = fill(f);
  assert.equal(r.code, 2);
  assert.equal(read(f), before);
});

test('rows with control characters are reported and not copied', () => {
  const bad = '- fx.M-SEC1 — has ‮ bidi — source: x';
  const f = fixture({ packs: { 'fx@1.md': `## Security\n${bad}\n${S2}\n` } });
  const r = fill(f);
  assert.deepEqual(added(r), ['added fx.M-SEC2']);
  assert.ok(r.lines.some(l => l.startsWith('skipped fx.M-SEC1')));
  assert.ok(!read(f).includes('‮'));
});

test('a long rule line is copied whole and reported', () => {
  const long = `- fx.M-SEC1 — ${'a'.repeat(3000)} — source: x`;
  const f = fixture({ packs: { 'fx@1.md': `## Security\n${long}\n` } });
  const r = fill(f);
  assert.ok(r.lines.includes('added fx.M-SEC1'));
  assert.ok(r.lines.some(l => l.startsWith('long fx.M-SEC1')));
  assert.ok(read(f).includes(long));
});

test('a standards.md with a CR byte is refused', () => {
  const f = fixture({ standards: '## Packs\r\n- .company/standards/fx@1.md — r\r\n' });
  assert.equal(fill(f).code, 2);
});

test('bad arguments are refused', () => {
  const f = fixture();
  assert.equal(main(['fill-security', f.file]).code, 2);
  assert.equal(main(['fill-security', '--packs', f.packDir]).code, 2);
  assert.equal(main(['fill-security', f.file, '--packs', f.file]).code, 2);
  assert.equal(main(['fill-security', f.file, '--packs', f.packDir, '--packs', f.packDir]).code, 2);
});

test('a duplicated marker heading is refused', () => {
  const f = fixture({ standards: `## Packs\n- .company/standards/fx@1.md — r\n${HEAD}\n${HEAD}\n` });
  assert.equal(fill(f).code, 2);
});

test('rows with zero-width or tag characters are reported and not copied', () => {
  for (const hidden of ['​', '⁠', '\u{e0049}\u{e0047}', '᠎', '﻿']) {
    const bad = `- fx.M-SEC1 — has ${hidden} hidden — source: x`;
    const f = fixture({ packs: { 'fx@1.md': `## Security\n${bad}\n${S2}\n` } });
    const r = fill(f);
    assert.deepEqual(added(r), ['added fx.M-SEC2'], JSON.stringify(hidden));
    assert.ok(r.lines.some(l => l.startsWith('skipped fx.M-SEC1')));
    assert.ok(!read(f).includes(hidden));
  }
});
