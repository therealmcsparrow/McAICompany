// Tests for skill-catalog v1.1 (C14, T31): `role-skills stamp check|write`.
// The stamp is .company/role-skills-stamp.json (sha-256 of catalog, selections and install-skills --status lines).
// `stamp check` prints `unchanged` when it matches, `changed` otherwise (also with no stamp file). Red until T31 lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './role-skills.mjs';

const TODAY = '2026-11-20';
const A = 'a'.repeat(40);

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-skills-stamp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function setup(t) {
  const cwd = tmp(t);
  const home = tmp(t);
  fs.mkdirSync(path.join(cwd, '.company'));
  return { cwd, home };
}
function run(p, args, payload) {
  const out = [];
  const stdin = payload === undefined ? '' : `${JSON.stringify(payload)}\n`;
  const code = main(args, { cwd: p.cwd, home: p.home, today: TODAY, stdin, log: (s) => out.push(s) });
  return { code, out, text: out.join('\n') };
}
const stampFile = (p) => path.join(p.cwd, '.company', 'role-skills-stamp.json');
const ENTRY = { name: 'my-skill', repo: 'octo/thing', commit: A, category: 'engineering', license: 'MIT' };

test('stamp write then stamp check with no change prints unchanged', (t) => {
  const p = setup(t);
  const w = run(p, ['stamp', 'write']);
  assert.equal(w.code, 0, w.text);
  assert.equal(fs.existsSync(stampFile(p)), true);
  const c = run(p, ['stamp', 'check']);
  assert.equal(c.code, 0, c.text);
  assert.match(c.text, /\bunchanged\b/);
  assert.doesNotMatch(c.text, /(?<!un)changed/);
});

test('after a catalog change stamp check prints changed', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['stamp', 'write']).code, 0);
  const a = run(p, ['add'], { ...ENTRY, save: true });
  assert.equal(a.code, 0, a.text);
  const c = run(p, ['stamp', 'check']);
  assert.match(c.text, /(?<!un)changed/);
});

test('after stamp write following the change, check prints unchanged again', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['add'], { ...ENTRY, save: true }).code, 0);
  assert.equal(run(p, ['stamp', 'write']).code, 0);
  assert.match(run(p, ['stamp', 'check']).text, /\bunchanged\b/);
});

test('a changed selection (project settings) also reads as changed', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['stamp', 'write']).code, 0);
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, roles: { 'backend-engineer': { skills: [{ name: 'tanstack-query', approved: TODAY }] } } } }));
  assert.match(run(p, ['stamp', 'check']).text, /(?<!un)changed/);
});

test('with no stamp file, check prints changed', (t) => {
  const p = setup(t);
  assert.match(run(p, ['stamp', 'check']).text, /(?<!un)changed/);
});

test('a corrupt stamp file reads as changed and never throws', (t) => {
  const p = setup(t);
  fs.writeFileSync(stampFile(p), '{not json');
  const c = run(p, ['stamp', 'check']);
  assert.match(c.text, /(?<!un)changed/);
});

test('the stamp holds sha-256 hex, not skill text', (t) => {
  const p = setup(t);
  run(p, ['add'], { ...ENTRY, save: true });
  run(p, ['stamp', 'write']);
  const raw = fs.readFileSync(stampFile(p), 'utf8');
  assert.match(raw, /[0-9a-f]{64}/);
  assert.ok(!raw.includes('octo/thing'));
});

test('stamp with a bad subcommand or extra argument is refused with exit 1', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['stamp']).code, 1);
  assert.equal(run(p, ['stamp', 'bogus']).code, 1);
  assert.equal(run(p, ['stamp', 'write', 'extra']).code, 1);
});
