#!/usr/bin/env node
// Usage: node scripts/review-depth.mjs <base-sha> [--risk low|medium|high]
// Review depth follows the paths a diff touches (contract review-depth v1), never the builder's label.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{7,40}$/;
const RISKS = ['low', 'medium', 'high'];
const SEC_WORDS = ['auth', 'login', 'session', 'token', 'secret', 'crypt', 'password', 'payment', 'billing', 'permission'];
const CONTRACT_FILE = /^(openapi|asyncapi)\./;
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json', 'cargo.lock', 'poetry.lock', 'gemfile.lock', 'composer.lock', 'go.sum', 'uv.lock']);

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

function ruleFor(file, core) {
  const lower = norm(file).toLowerCase();
  const segs = lower.split('/');
  const base = segs[segs.length - 1];
  for (const c of core) {
    const cn = norm(c).toLowerCase();
    if (cn && (lower === cn || lower.startsWith(cn + '/'))) return 'core path';
  }
  if (lower.startsWith('docs/contracts/') || segs.slice(0, -1).includes('contracts') || base.endsWith('.proto') || CONTRACT_FILE.test(base)) return 'contract path';
  if (segs.some((s) => SEC_WORDS.some((w) => s.includes(w)))) return 'security path';
  if (segs.includes('migrations')) return 'security path (migrations)';
  if (lower.startsWith('.github/workflows/')) return 'security path (workflows)';
  if (/^agents\/[^/]+\.md$/.test(lower)) return 'security path (agent prompt)';
  if (lower === '.company/standards.md' || lower.startsWith('.company/standards/') || lower === '.company/checks.json' || lower === '.company/settings.json') return 'security path (ruleset/settings)';
  if (base === 'package.json' || LOCKFILES.has(base) || lower.startsWith('deps/')) return 'security path (dependencies)';
  return null;
}

export function classify(paths, { core = [], risk } = {}) {
  const reasons = [];
  for (const f of paths) {
    const r = ruleFor(f, core);
    if (r) reasons.push(`reason: ${f} — ${r}`);
  }
  if (risk === 'high') reasons.unshift('reason: risk tier — high');
  return { depth: reasons.length ? 'full' : 'standard', reasons };
}

export function coreFromProject(text) {
  const out = [];
  let inCore = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^##\s/.test(line)) { inCore = /^##\s+Core\s*$/.test(line); continue; }
    if (!inCore) continue;
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    const item = m[1].split(':')[0].trim().replace(/^`|`$/g, '');
    if (item && !item.startsWith('(')) out.push(item);
  }
  return out;
}

function refuse(msg) {
  process.stdout.write(`refused: ${msg}\n`);
  process.exit(2);
}

function main(argv) {
  let sha;
  let risk;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--risk') {
      risk = argv[++i];
      if (!RISKS.includes(risk)) refuse('--risk must be low, medium or high');
    } else if (sha === undefined && !argv[i].startsWith('-')) sha = argv[i];
    else refuse('unexpected argument');
  }
  if (sha === undefined || !SHA.test(sha)) refuse('base-sha must match ^[0-9a-f]{7,40}$');

  let core = [];
  try {
    core = coreFromProject(fs.readFileSync(path.join(process.cwd(), '.company', 'project.md'), 'utf8'));
  } catch { /* no profile: no Core paths */ }

  let paths;
  try {
    const out = execFileSync('git', ['diff', '-z', '--name-only', `${sha}..HEAD`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    paths = out.split('\0').filter(Boolean);
  } catch {
    process.stdout.write('full\nreason: diff unavailable\n');
    return;
  }
  const { depth, reasons } = classify(paths, { core, risk });
  process.stdout.write([depth, ...reasons].join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
