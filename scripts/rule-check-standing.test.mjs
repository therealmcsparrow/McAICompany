// Tests for rule-check v1.7 (C15, T32): `standing --write` writes .company/rules/standing-slice.md (the Must rules
// bound to the stack plus the sha-256 of .company/standards.md); `standing check` prints `fresh` only when that
// sha matches, else `stale`; `standingFresh` is exported. Red until T32 lands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as rc from './rule-check.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const PACK = '---\ntool: fx\n---\n## Must\n- fx.M1 — plain must — source: x\n## Should\n- fx.S1 — should — source: x\n';
const STANDARDS = '## Packs\n- .company/standards/fx@1.md — researched 2026-10-29\n## Project rules\n- proj.M1 — own rule — why: w — source: x\n## Exceptions\n## Debt\n';

function project(standards = STANDARDS) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rc-standing-'));
  made.push(root);
  fs.mkdirSync(path.join(root, '.company', 'standards'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'standards.md'), standards);
  fs.writeFileSync(path.join(root, '.company', 'standards', 'fx@1.md'), PACK);
  return root;
}
const slice = (root) => path.join(root, '.company', 'rules', 'standing-slice.md');
const std = (root) => path.join(root, '.company', 'standards.md');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const text = (r) => (r.lines ?? []).join('\n');
const write = (root) => rc.main(['standing', '--write', '--root', root]);
const check = (root) => rc.main(['standing', 'check', '--root', root]);

test('standing --write writes the slice file with the sha-256 of standards.md', () => {
  const root = project();
  const r = write(root);
  assert.equal(r.code, 0, text(r));
  assert.equal(fs.existsSync(slice(root)), true);
  assert.ok(fs.readFileSync(slice(root), 'utf8').includes(sha(fs.readFileSync(std(root), 'utf8'))));
});

test('the slice holds the Must rules and not the Should rules', () => {
  const root = project();
  write(root);
  const s = fs.readFileSync(slice(root), 'utf8');
  assert.ok(s.includes('fx.M1'));
  assert.ok(!s.includes('fx.S1'));
});

test('standing check after --write prints fresh', () => {
  const root = project();
  write(root);
  const r = check(root);
  assert.equal(r.code, 0, text(r));
  assert.match(text(r), /\bfresh\b/);
  assert.doesNotMatch(text(r), /stale/);
});

test('after a standards.md edit, standing check prints stale', () => {
  const root = project();
  write(root);
  fs.appendFileSync(std(root), '- proj.M2 — another rule — why: w — source: x\n');
  const r = check(root);
  assert.match(text(r), /\bstale\b/);
  assert.doesNotMatch(text(r), /\bfresh\b/);
});

test('writing again after the edit makes it fresh again', () => {
  const root = project();
  write(root);
  fs.appendFileSync(std(root), '\n');
  assert.match(text(check(root)), /\bstale\b/);
  write(root);
  assert.match(text(check(root)), /\bfresh\b/);
});

test('with no slice file standing check prints stale', () => {
  const root = project();
  assert.match(text(check(root)), /\bstale\b/);
});

test('a slice file with a wrong sha reads as stale, never fresh', () => {
  const root = project();
  write(root);
  const s = fs.readFileSync(slice(root), 'utf8').replace(sha(fs.readFileSync(std(root), 'utf8')), '0'.repeat(64));
  fs.writeFileSync(slice(root), s);
  assert.match(text(check(root)), /\bstale\b/);
});

test('standingFresh is exported and agrees with the command', () => {
  assert.equal(typeof rc.standingFresh, 'function');
  const root = project();
  assert.equal(rc.standingFresh(root), false);
  write(root);
  assert.equal(rc.standingFresh(root), true);
  fs.appendFileSync(std(root), '\n');
  assert.equal(rc.standingFresh(root), false);
});

test('no standards.md: standing --write is refused and writes nothing', () => {
  const root = project();
  fs.rmSync(std(root));
  const r = write(root);
  assert.notEqual(r.code, 0);
  assert.equal(fs.existsSync(slice(root)), false);
});
