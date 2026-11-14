// Sweep for the configurable context cap: the old numbers 95000 and 85500 and phrases such as "fixed cap" or
// "fixed Context cap" may stay only where history lives, and the CHANGELOG and the ADRs record the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const TEXT = /\.(md|mjs|js|json|txt|html|css|ts|tsx|yml|yaml)$/;
const OLD = /95000|85500|fixed (?:`?Context )?cap/i;

// Tracked and untracked-not-ignored files of the plugin tree; .company is project data, never shipped.
const files = () => execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean).filter((f) => !f.startsWith('.company/') && TEXT.test(f) && fs.existsSync(path.join(root, f)));

// The allowed list. A test file is a pin of the old values, never shipped text.
const allowedFile = (f) => f === 'CHANGELOG.md'
  || f.startsWith('docs/adr/')
  || f.startsWith('docs/specs/')
  || f === 'tests/lead-handover/evidence.md'
  || f.startsWith('tests/regression/')
  || f === 'tests/contracts/dispatch-prompt/step.txt'
  || /\.test\.(mjs|js|ts|tsx)$/.test(f);

// A Contract may keep the old values in its header block: every line before the first `## ` heading.
const contractHeaderEnd = (text) => {
  const at = text.search(/^## /m);
  return at < 0 ? text.length : at;
};

test('95000, 85500 and "fixed cap" appear only on the allowed list (CHANGELOG history, ADRs, dated specs, evidence, regression fixtures, Contract header blocks)', () => {
  const all = files();
  assert.ok(all.length > 300, `the sweep saw ${all.length} files`);
  assert.ok(all.includes('skills/pipeline/SKILL.md') && all.includes('scripts/lead-handover.mjs'), 'the sweep reaches skills and scripts');
  const bad = [];
  for (const f of all) {
    if (allowedFile(f)) continue;
    const text = read(f);
    const headerEnd = /^docs\/contracts\/.+\.md$/.test(f) ? contractHeaderEnd(text) : 0;
    let offset = 0;
    text.split('\n').forEach((line, i) => {
      if (OLD.test(line) && offset >= headerEnd) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      offset += line.length + 1;
    });
  }
  assert.deepEqual(bad, [], `old cap text outside the allowed list:\n${bad.join('\n')}`);
});

test('the code defaults are the new cap: lead-handover, ledger, dashboard tokens, ctx-row and settings name no 95000/85500 and carry 180000/162000 where they hold a default', () => {
  const lead = read('scripts/lead-handover.mjs');
  assert.match(lead, /export const CAP = 180000;/);
  assert.match(lead, /export const HANDOVER_AT = 162000;/);
  assert.match(read('scripts/settings.mjs'), /CONTEXT_CAP_DEFAULT\b[^\n]*180000|from '\.\.\/mods\/lib\/context-cap\.mjs'/);
  assert.ok(fs.existsSync(path.join(root, 'mods/lib/context-cap.mjs')), 'the one formula lives in mods/lib/context-cap.mjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts/run-cap.mjs')), 'runCap lives in scripts/run-cap.mjs');
});

test('ADR 0047 is marked superseded by 0069 and ADR 0069 exists with the new default', () => {
  const old = read('docs/adr/0047-one-context-cap.md');
  assert.match(old, /^Status: superseded by docs\/adr\/0069-configurable-context-cap\.md/m);
  const adr = read('docs/adr/0069-configurable-context-cap.md');
  for (const s of ['180000', '0047', '90%']) assert.ok(adr.includes(s), `0069 names ${s}`);
  for (const p of ['docs/adr/0049-lead-handover-mechanism.md', 'docs/adr/0056-hard-handover-outside-agent.md']) {
    assert.ok(read(p).includes("Amended 2026-11-14: the cap and handover are now the run's values (ADR 0069)."), `${p} amendment line`);
  }
});

// release.mjs moves [Unreleased] into a version section, so the newest non-empty entry (Unreleased or a
// released version) holds the note. AICO_CHANGELOG_FILE lets a run point at a changelog copy.
const newestEntry = (log) => {
  const sections = log.split(/^## \[/m).slice(1);
  return sections.find((s, i) => i > 0 || s.replace(/^[^\n]*\n/, '').trim().length > 0) ?? '';
};
const checkNote = (top) => {
  assert.match(top, /^(Unreleased|\d+\.\d+\.\d+)\]/, 'the newest entry (Unreleased or a released version) holds the note');
  for (const s of ['180000', '162000', 'aico-settings', 'ADR 0069']) assert.ok(top.includes(s), `the note names ${s}`);
  assert.match(top, /context_cap/);
  assert.match(top, /take(s)? effect/);
};

test('the CHANGELOG records the new default and that a stored context_cap now takes effect', () => {
  const log = process.env.AICO_CHANGELOG_FILE ? fs.readFileSync(process.env.AICO_CHANGELOG_FILE, 'utf8') : read('CHANGELOG.md');
  checkNote(newestEntry(log));
});

test('changelog note check accepts the note under Unreleased or the released version, rejects it missing', () => {
  const note = '- 180000 and 162000 via aico-settings, ADR 0069: a stored context_cap takes effect.\n';
  const old = '## [0.38.1] - 2026-11-14\n\n- old\n';
  const before = '# Changelog\n\n## [Unreleased]\n\n' + note + '\n' + old;
  const after = '# Changelog\n\n## [Unreleased]\n\n## [0.39.0] - 2026-11-14\n\n' + note + '\n' + old;
  checkNote(newestEntry(before));
  checkNote(newestEntry(after));
  assert.throws(() => checkNote(newestEntry(after.replace(note, '- other\n'))));
});

test('shipped docs and skills touched by the cap are LF only', () => {
  for (const f of ['CHANGELOG.md', 'README.md', 'GLOSSARY.md', 'skills/pipeline/SKILL.md', 'skills/handoff/SKILL.md', 'documentation/start/setup.md', 'documentation/commands/settings.md']) {
    assert.ok(!read(f).includes('\r'), `${f} has CRLF`);
  }
});
