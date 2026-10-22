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

// Playbooks that dispatch no Role and only print or run a CLI: they need no language resolution.
export const LANGUAGE_EXEMPT = new Set(['setup', 'language']);
const NAME_RE =/^[a-z0-9][a-z0-9-]{0,63}\*?$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROLE_COUNT_RE = /\b(\d+)\s+(?:\*\*)?Role(?:\*\*)?\s+agents\b|\ball\s+(\d+)\s+Roles\b/gi;

function realDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Fenced code blocks as { line, text }. A fence closes on a line of at least as many backticks as it opened with.
function fencedBlocks(text) {
  const blocks = [];
  let open = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!open) {
      const m = /^(`{3,})/.exec(t);
      if (m) open = { len: m[1].length, line: i + 1, lines: [] };
    } else if (/^`{3,}$/.test(t) && t.length >= open.len) {
      blocks.push({ line: open.line, text: open.lines.join('\n') });
      open = null;
    } else open.lines.push(line);
  });
  return blocks;
}

// deps/skills.json: agentsec.M-SEC7 patterns on name/source, agentsec.M-SEC6 license/vetted on `research`.
function checkManifest(root, errors) {
  const file = join(root, 'deps', 'skills.json');
  if (!existsSync(file)) return;
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); }
  catch { errors.push('ERROR deps/skills.json: invalid JSON'); return; }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('ERROR deps/skills.json: top level must be an object of groups');
    return;
  }
  for (const group of Object.keys(manifest)) {
    const entries = manifest[group];
    if (!Array.isArray(entries)) { errors.push(`ERROR deps/skills.json: group ${group} must be an array`); continue; }
    entries.forEach((e, i) => {
      const at = `deps/skills.json: ${group}[${i}]`;
      if (e === null || typeof e !== 'object') { errors.push(`ERROR ${at}: entry must be an object`); return; }
      const isInclude = Object.hasOwn(e, 'include');
      if (!isInclude) {
        if (typeof e.name !== 'string' || !NAME_RE.test(e.name)) errors.push(`ERROR ${at}: name fails the agentsec.M-SEC7 pattern`);
        if (Object.hasOwn(e, 'source')) {
          const src = e.source;
          if (typeof src !== 'string' || !REPO_RE.test(src) || src.endsWith('/.') || src.endsWith('/..'))
            errors.push(`ERROR ${at}: source fails the agentsec.M-SEC7 pattern`);
        }
        if (group === 'research') {
          if (typeof e.license !== 'string' || !LICENSE_RE.test(e.license)) errors.push(`ERROR ${at}: research entry needs a valid license`);
          if (typeof e.vetted !== 'string' || !realDate(e.vetted)) errors.push(`ERROR ${at}: research entry needs a valid vetted date`);
        }
      }
    });
  }
}

// Role count in the plugin description and docs, and every agent listed in roles.md and the spec roster.
function checkRoleCounts(root, roleNames, errors) {
  if (!roleNames.size) return;
  const n = roleNames.size;
  const files = ['.claude-plugin/plugin.json', 'README.md', 'documentation/README.md', 'documentation/roles.md', 'docs/spec.md'];
  for (const rel of files) {
    const f = join(root, rel);
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(ROLE_COUNT_RE)) {
      const found = Number(m[1] ?? m[2]);
      if (found !== n) errors.push(`ERROR ${rel}: Role count ${found} != ${n} agents/*.md`);
    }
  }
  const rolesDoc = join(root, 'documentation', 'roles.md');
  if (existsSync(rolesDoc)) {
    const t = readFileSync(rolesDoc, 'utf8');
    for (const a of roleNames) if (!t.includes(`**${a}**`)) errors.push(`ERROR documentation/roles.md: Role ${a} missing`);
  }
  const spec = join(root, 'docs', 'spec.md');
  if (existsSync(spec)) {
    const t = readFileSync(spec, 'utf8');
    for (const a of roleNames) if (!t.includes(`| ${a} |`)) errors.push(`ERROR docs/spec.md: Role ${a} missing from the roster`);
  }
}

export function check(root) {
  const errors = [], warnings = [], names = new Set(), units = [], playbooks = [];
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
    if (u.kind === 'skill' && fm['disable-model-invocation'] === 'true') playbooks.push({ rel, name: u.expected, text });
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

  // Version consistency: plugin.json is the source of truth; other files must agree.
  // Skipped entirely when plugin.json is absent (e.g. test fixtures), so it never false-fails.
  const pluginFile = join(root, '.claude-plugin', 'plugin.json');
  if (existsSync(pluginFile)) {
    const vm = readFileSync(pluginFile, 'utf8').match(/"version":\s*"([^"]+)"/);
    const version = vm && vm[1];
    const sources = [
      ['CHANGELOG.md', /##\s*\[?v?(\d+\.\d+\.\d+)/],
      ['documentation/README.md', /Current:\s*\*{0,2}(\d+\.\d+\.\d+)/],
    ];
    for (const [rel, re] of sources) {
      const f = join(root, rel);
      if (!existsSync(f)) continue;
      const m = readFileSync(f, 'utf8').match(re);
      if (version && m && m[1] !== version)
        errors.push(`ERROR ${rel}: version ${m[1]} != plugin.json ${version}`);
    }
  }
  // Language rule (dispatch-prompt v2): every dispatch block and every Playbook resolves and passes the language.
  for (const file of [...mdFiles(skillsDir), ...mdFiles(agentsDir)]) {
    const rel = relative(root, file).split(sep).join('/');
    for (const b of fencedBlocks(readFileSync(file, 'utf8')))
      if (b.text.includes('Company profile:') && !b.text.includes('Language:'))
        errors.push(`ERROR ${rel}:${b.line}: dispatch block has Company profile: but no Language:`);
  }
  for (const p of playbooks)
    if (!LANGUAGE_EXEMPT.has(p.name) && !p.text.includes('aico:pipeline') && !p.text.includes('§1.6'))
      errors.push(`ERROR ${p.rel}: Playbook mentions neither aico:pipeline nor §1.6 (Language rule)`);

  const commandsDoc = join(root, 'documentation', 'commands.md');
  if (existsSync(commandsDoc)) {
    const doc = readFileSync(commandsDoc, 'utf8').split(/\r?\n/).map(l => l.trim());
    for (const p of playbooks)
      if (!doc.some(l => l === `### /aico:${p.name}` || l === `### \`/aico:${p.name}\``))
        errors.push(`ERROR documentation/commands.md: Playbook ${p.name} has no ### /aico:${p.name} entry`);
  }
  checkManifest(root, errors);
  checkRoleCounts(root, agentNames, errors);
  return { errors: [...new Set(errors)], warnings };
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..');
  const { errors, warnings } = check(root);
  [...errors, ...warnings].forEach(l => console.log(l));
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
