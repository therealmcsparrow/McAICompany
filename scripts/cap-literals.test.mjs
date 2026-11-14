// release 1 has one cap enforcer, the handoff mod. The cap numbers live in
// hooks/rules/cap.mjs only; no other production file holds `180000` or `162000`; scripts/context-guard.mjs is gone.
// Scanned set and exemptions are: tracked and new `*.mjs`, `*.js`, `*.ts`, `*.tsx`,
// `*.html` under scripts/, hooks/, mods/, without `*.test.*`, `mods/test/`, `tests/`, `scripts/fixtures/`,
// `hooks/fixtures/`. Exempt: hooks/rules/cap.mjs and the one skillspector line (a 3-minute timeout in ms).
// Skill text, docs and README may name the defaults, so they are not scanned.
// Fails while scripts/context-guard.mjs exists or lead-handover, dashboard-tokens, settings-page and
// mods/lib/context-cap.mjs hold literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const LITERAL = /(?<![\d_.])(?:180_?000|162_?000)(?![\d_])/;
const EXT = /\.(mjs|js|ts|tsx|html)$/;
const SCANNED = /^(scripts|hooks|mods)\//;
const SKIPPED = (f) => /\.test\./.test(f) || f.startsWith('mods/test/') || f.startsWith('tests/')
  || f.startsWith('scripts/fixtures/') || f.startsWith('hooks/fixtures/');
const EXEMPT_FILE = 'hooks/rules/cap.mjs';

const listed = () => execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
const scanned = () => listed().filter((f) => SCANNED.test(f) && EXT.test(f) && !SKIPPED(f));

test('the matcher sees both literals and the underscore forms, and not longer numbers', () => {
  for (const hit of ['const A = 180000;', 'x = 162000', '180_000', '[162000]', "'no-llm': 180000,"]) assert.match(hit, LITERAL, hit);
  for (const miss of ['1800000', '1620001', 'v1.180000', '0.180000', '180001', 'a2180000']) assert.doesNotMatch(miss, LITERAL, miss);
});

test('the scanned set is the production code of scripts/, hooks/ and mods/ (sanity)', () => {
  const all = scanned();
  assert.ok(all.length > 40, `the scan saw ${all.length} files`);
  for (const f of ['scripts/run-cap.mjs', 'scripts/lead-handover.mjs', 'scripts/dashboard-tokens.mjs', 'scripts/settings-page.html', 'mods/lib/context-cap.mjs', 'scripts/skillspector.mjs']) {
    assert.ok(all.includes(f), `${f} is scanned`);
  }
  assert.ok(!all.some((f) => /\.test\./.test(f) || f.startsWith('tests/') || f.startsWith('hooks/fixtures/')), 'tests and fixtures are not scanned');
});

test('AC13: no production file but hooks/rules/cap.mjs and one skillspector line holds 180000 or 162000', () => {
  const bad = [];
  for (const f of scanned()) {
    if (f === EXEMPT_FILE) continue;
    read(f).split('\n').forEach((line, i) => {
      if (!LITERAL.test(line)) return;
      if (f === 'scripts/skillspector.mjs' && /TIMEOUT_MS/.test(line)) return;
      bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [], `cap literals outside the one home:\n${bad.join('\n')}`);
});

test('the skillspector exemption is the one 3-minute timeout line, and only that line', () => {
  const hits = read('scripts/skillspector.mjs').split('\n').filter((l) => LITERAL.test(l));
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.match(hits[0], /TIMEOUT_MS = \{ 'no-llm': 180000, claude_cli: 900000 \}/);
});

test('hooks/rules/cap.mjs is the one home: it holds the default and the 0.9 formula', () => {
  assert.ok(fs.existsSync(path.join(root, EXEMPT_FILE)), `${EXEMPT_FILE} exists`);
  const src = read(EXEMPT_FILE);
  assert.match(src, LITERAL);
  assert.match(src, /0\.9|\*\s*9\s*\/\s*10/);
  assert.match(src, /\b60000\b/);
  assert.match(src, /\b250000\b/);
});

test('AC13: scripts/context-guard.mjs is gone and nothing in production names it', () => {
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'context-guard.mjs')), false, 'scripts/context-guard.mjs still exists');
  const bad = scanned().filter((f) => /context-guard\.mjs/.test(read(f)));
  assert.deepEqual(bad, []);
  assert.doesNotMatch(read('hooks/hooks.json'), /context-guard/);
});

test('the retired off switch AICO_CONTEXT_GUARD is read by no production file (lead-handoff v2.4: watch follows AICO_GUARDS)', () => {
  const bad = scanned().filter((f) => /AICO_CONTEXT_GUARD/.test(read(f)));
  assert.deepEqual(bad, []);
});

test('the re-exports keep their values: CAP and HANDOVER_AT of lead-handover, the formula of mods/lib/context-cap', async () => {
  const lead = await import('./lead-handover.mjs');
  assert.equal(lead.CAP, 180000);
  assert.equal(lead.HANDOVER_AT, 162000);
  const file = path.join(root, 'mods', 'lib', 'context-cap.mjs');
  if (fs.existsSync(file)) {
    const m = await import(new URL(`file:///${file.replace(/\\/g, '/')}`).href);
    assert.equal(m.CONTEXT_CAP_DEFAULT, 180000);
    assert.equal(m.handoverOf(180000), 162000);
    assert.equal(m.handoverOf(100001), 90000);
  }
});
