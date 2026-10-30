// Regression: frontmatter plain scalars must parse as YAML ("Nested mappings are not allowed in compact mappings").
// No npm deps, so this is a small strict checker for the top-level `key: value` lines Claude Code reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? mdFiles(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

export function plainProblem(value) {
  if (value === '') return null;
  const c = value[0];
  if (c === '"') return /^"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(value) ? null : 'double-quoted value not cleanly closed';
  if (c === "'") return /^'(?:[^']|'')*'\s*(?:#.*)?$/.test(value) ? null : 'single-quoted value not cleanly closed';
  if (c === '[' || c === '{' || c === '|' || c === '>') return null;
  if ('*&!%@`'.includes(c)) return `plain value starts with indicator ${c}`;
  if (/^[?:-](\s|$)/.test(value)) return `plain value starts with indicator "${c} "`;
  if (/(^|\s)#/.test(value)) value = value.replace(/(^|\s)#.*$/, '');
  if (/:(\s|$)/.test(value)) return 'plain value contains ": " or ends in ":" (nested mapping error); quote or reword';
  return null;
}

export function scan(file, text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return [];
  const end = lines.indexOf('---', 1);
  if (end < 0) return [];
  const out = [];
  let inBlock = false;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || line === '') { continue; }
    const m = /^([A-Za-z_][\w-]*):(?:\s+(.*?))?\s*$/.exec(line);
    if (!m) { if (!/^#/.test(line)) out.push(`${file}:${i + 1}: not a "key: value" line`); continue; }
    const why = plainProblem(m[2] ?? '');
    if (why) out.push(`${file}:${i + 1}: ${m[1]}: ${why}`);
  }
  return out;
}

const files = [
  ...mdFiles(path.join(root, 'skills')),
  ...mdFiles(path.join(root, 'agents')),
  ...mdFiles(path.join(root, 'commands')),
];

test('checker pins the known breakers', () => {
  assert.ok(plainProblem('a: b'));
  assert.ok(plainProblem('ends with:'));
  for (const c of '*&!%@`') assert.ok(plainProblem(`${c}x`), c);
  assert.ok(plainProblem('"open'));
  assert.equal(plainProblem('"a: b"'), null);
  assert.equal(plainProblem('<a> | resume <slug>'), null);
  assert.equal(plainProblem('see a:b and c #x'), null);
});

test('frontmatter of every skill, agent and command is valid YAML plain/quoted scalars', () => {
  assert.ok(files.length > 50, 'found the files');
  const bad = files.flatMap(f => scan(path.relative(root, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});
