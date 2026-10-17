#!/usr/bin/env node
// Structural checker for the aico plugin. Errors fail; size overruns only warn.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMITS = { agent: 50, skill: 125, description: 1024 };
const MODELS = new Set(['opus', 'sonnet', 'haiku', 'inherit']);

function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return fm;
}

const lineCount = text => text.replace(/\r?\n$/, '').split(/\r?\n/).length;

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? mdFiles(p) : p.endsWith('.md') ? [p] : [];
  });
}

export function check(root) {
  const errors = [], warnings = [], names = new Set(), units = [];
  const skillNames = new Set(), agentNames = new Set();
  const skillsDir = join(root, 'skills'), agentsDir = join(root, 'agents');

  if (existsSync(skillsDir)) for (const dir of readdirSync(skillsDir)) {
    const file = join(skillsDir, dir, 'SKILL.md');
    if (existsSync(file)) units.push({ kind: 'skill', file, expected: dir });
  }
  if (existsSync(agentsDir)) for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.md')))
    units.push({ kind: 'agent', file: join(agentsDir, f), expected: f.slice(0, -3) });

  for (const u of units) {
    const rel = relative(root, u.file).split(sep).join('/');
    const text = readFileSync(u.file, 'utf8');
    const fm = frontmatter(text);
    names.add(u.expected);
    (u.kind === 'skill' ? skillNames : agentNames).add(u.expected);
    if (!fm) { errors.push(`ERROR ${rel}: missing frontmatter`); continue; }
    if (fm.name !== u.expected) errors.push(`ERROR ${rel}: name mismatch (${fm.name} vs ${u.expected})`);
    if (!fm.description) errors.push(`ERROR ${rel}: missing description`);
    else if (fm.description.length > LIMITS.description) errors.push(`ERROR ${rel}: description too long (${fm.description.length} > ${LIMITS.description})`);
    if (u.kind === 'agent' && fm.model && !MODELS.has(fm.model)) errors.push(`ERROR ${rel}: invalid model ${fm.model}`);
    const n = lineCount(text), max = LIMITS[u.kind];
    if (n > max) warnings.push(`WARN ${rel}: ${u.kind} ${n} > ${max} lines`);
  }

  for (const n of skillNames) if (agentNames.has(n)) errors.push(`ERROR agents/${n}.md: name clash ${n} (skill and agent)`);

  for (const file of [...mdFiles(skillsDir), ...mdFiles(agentsDir), ...mdFiles(join(root, 'company'))]) {
    const rel = relative(root, file).split(sep).join('/');
    for (const [, ref] of readFileSync(file, 'utf8').matchAll(/aico:([a-z0-9-]+)/g))
      if (!names.has(ref)) errors.push(`ERROR ${rel}: unknown reference aico:${ref}`);
  }
  return { errors: [...new Set(errors)], warnings };
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..');
  const { errors, warnings } = check(root);
  [...errors, ...warnings].forEach(l => console.log(l));
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
