#!/usr/bin/env node
// step-close (contract: docs/contracts/step-close.md v1.0, plan task T25: stages 1-4 lint, scope, commit, ledger). Node built-ins only.
// One call after a Step: lint the Handoff, scope the commit candidates, commit them, record the ledger row. Every argument is
// untrusted; output holds fixed words, the slug, <NN>, <role>, digits and paths that passed the path rule.
// Git and the sibling scripts are started with argv arrays, never through a shell.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isRunSlug, exactWorkPath, workParts, runKey } from '../mods/lib/work-folder.mjs';
import { readParallel, parsePlan, normalizePath } from './plan-tasks.mjs';

const HERE = import.meta.dirname;
const PLUGIN_ROOT = path.resolve(HERE, '..');
const MSG_RE = /^(feat|fix|test|docs|refactor|chore): [\p{L}\p{N} .,:;/_()+#-]{1,72}$/u;
const NN_RE = /^(?!0+$)\d{2,3}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const USAGE_RE = /^(\d{1,8}),(\d{1,6}),(\d{1,9})$/;
const BAD_CHARS = /["'`$\\*?[\u0000-\u001f\u007f]/u;

class Refusal extends Error {}

const keysOverlap = (a, b) => a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);

function parseArgs(argv) {
  const [slug, nn, role, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const val = rest[i + 1];
    if (!['--handoff', '--msg', '--task', '--usage'].includes(flag) || val === undefined || Object.hasOwn(opts, flag)) throw new Refusal('usage');
    opts[flag] = val;
  }
  if (typeof slug !== 'string' || !isRunSlug(slug)) throw new Refusal('slug');
  if (!NN_RE.test(nn ?? '')) throw new Refusal('step');
  if (!ROLE_RE.test(role ?? '') || !fs.existsSync(path.join(PLUGIN_ROOT, 'agents', `${role}.md`))) throw new Refusal('role');
  const expected = `.company/work/${slug}/${nn}-${role}.md`;
  if (opts['--handoff'] !== expected) throw new Refusal('handoff path');
  if (!MSG_RE.test(opts['--msg'] ?? '')) throw new Refusal('msg');
  if (Object.hasOwn(opts, '--task') && !/^[A-Za-z0-9._-]{1,80}$/.test(opts['--task'])) throw new Refusal('task');
  let usage;
  if (Object.hasOwn(opts, '--usage')) {
    const m = USAGE_RE.exec(opts['--usage']);
    if (!m) throw new Refusal('usage flag');
    usage = [m[1], m[2], m[3]];
  }
  return { slug, nn, role, handoff: expected, msg: opts['--msg'], task: opts['--task'], usage };
}

function node(script, args, root) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', lines: (r.stdout ?? '').split('\n').filter(Boolean) };
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '' };
}

function gitChanged(root) {
  const r = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.code !== 0) return null;
  const set = new Set();
  const parts = r.out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    set.add(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++; // the rename's source is the next field
  }
  return set;
}

// Stage 1: returns { ok, files } or { ok: false, lines }.
function lint(root, handoff) {
  const r = node('handoff-lint.mjs', [handoff], root);
  if (r.code !== 0) return { ok: false, lines: r.lines.filter((l) => l.startsWith('ERROR ')) };
  const last = r.lines[r.lines.length - 1];
  let files = [];
  try {
    const routing = JSON.parse(last);
    if (Array.isArray(routing['files-touched'])) files = routing['files-touched'].filter((f) => typeof f === 'string');
  } catch { /* unreadable routing line: no extra candidates */ }
  return { ok: true, files };
}

// Stage 2. Returns { fail, lines, candidates, dropped }.
function scope(root, a, candidates) {
  const lines = [];
  let kept = candidates;
  let dropped = 0;
  if (a.task !== undefined) {
    const r = node('plan-tasks.mjs', ['scope', a.slug, a.task, '--', ...candidates], root);
    if (r.code !== 0) return { fail: true, lines: r.lines };
    const gone = new Set();
    for (const l of r.lines) {
      let m;
      if ((m = /^sibling (\S+) (\S+)$/.exec(l))) {
        lines.push(`dropped: ${m[2]} (task ${m[1]})`);
        gone.add(m[2]);
        dropped++;
      } else if ((m = /^extra (\S+)$/.exec(l))) lines.push(l);
    }
    kept = candidates.filter((c) => !gone.has(c.replaceAll('\\', '/')));
    return { fail: false, lines, candidates: kept, dropped };
  }
  const log = path.join(root, '.company', 'work', ...workParts(a.slug), 'parallel.jsonl');
  if (!fs.existsSync(log)) return { fail: false, lines, candidates: kept, dropped };
  let view;
  let tasks;
  try {
    view = readParallel(root, a.slug);
    if (view.state === 'none' || view.running.length === 0) return { fail: false, lines, candidates: kept, dropped };
    const plan = fs.readFileSync(path.join(root, '.company', 'work', ...workParts(a.slug), view.plan), 'utf8');
    tasks = parsePlan(plan, { slug: a.slug }).tasks;
  } catch {
    return { fail: true, lines: [] };
  }
  const sets = view.running.map((id) => ({ id, keys: tasks.find((t) => t.id === id)?.keys ?? [] }));
  kept = [];
  for (const c of candidates) {
    const n = normalizePath(c);
    const hit = n.ok ? sets.find((s) => s.keys.some((k) => keysOverlap(k, n.key))) : undefined;
    if (hit) {
      lines.push(`dropped: ${n.path} (task ${hit.id})`);
      dropped++;
    } else kept.push(c);
  }
  return { fail: false, lines, candidates: kept, dropped };
}

const charOk = (p) => p !== '' && !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.startsWith('-') && !p.startsWith(':')
  && !p.split('/').includes('..') && !BAD_CHARS.test(p);

function hasHook(root, a) {
  try {
    const text = fs.readFileSync(path.join(root, '.company', 'ledger', `${runKey(a.slug)}.jsonl`), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r && (r.src ?? r.source) === 'hook' && r.kind !== 'lead' && (r.id ?? r.step) === a.nn && r.role === a.role) return true;
    }
  } catch { /* no ledger yet */ }
  return false;
}

export function close(argv, root = process.cwd()) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    if (e instanceof Refusal) return { code: 2, lines: [`refused: ${e.message}`] };
    throw e;
  }
  try { exactWorkPath({ fs, path }, root, workParts(a.slug)); } catch { return { code: 2, lines: ['refused: wrong letter case'] }; }
  const st = (() => { try { return fs.lstatSync(path.join(root, ...a.handoff.split('/'))); } catch { return null; } })();
  if (!st || !st.isFile() || st.isSymbolicLink()) return { code: 2, lines: ['refused: handoff path'] };

  const l = lint(root, a.handoff);
  if (!l.ok) return { code: 1, lines: [...l.lines, 'step-close: lint failed'] };

  const cands = [...new Set([a.handoff, ...l.files])];
  const s = scope(root, a, cands);
  if (s.fail) return { code: 1, lines: [...s.lines, 'step-close: scope failed'] };
  const out = [...s.lines];
  let dropped = s.dropped;

  const changed = gitChanged(root);
  if (changed === null) return { code: 3, lines: ['step-close: commit failed'] };
  const keep = [];
  for (const c of s.candidates) {
    if (!charOk(c) || /^\.env/.test(path.basename(c)) || !changed.has(c)) {
      out.push(`dropped: ${charOk(c) ? c : '?'}`);
      dropped++;
    } else keep.push(c);
  }
  if (keep.length === 0) return { code: 3, lines: [...out, 'step-close: commit failed'] };
  if (git(root, ['--literal-pathspecs', 'add', '--', ...keep]).code !== 0
    || git(root, ['--literal-pathspecs', 'commit', '-q', '-m', a.msg, '--', ...keep]).code !== 0) {
    return { code: 3, lines: [...out, 'step-close: commit failed'] };
  }
  const sha = git(root, ['rev-parse', '--short', 'HEAD']).out.trim();

  let ledger = 'missing';
  const tail = [];
  if (hasHook(root, a)) ledger = 'hook';
  else if (a.usage) {
    const r = node('ledger.mjs', ['add', a.slug, 'step', a.nn, a.role, 'step-close', ...a.usage.slice(0, 1), ...a.usage.slice(1)], root);
    if (r.code === 0 || r.code === 4) {
      ledger = 'added';
      if (r.code === 4) tail.push(...r.lines.filter((x) => x.startsWith('over cap:')));
    }
  }
  const first = `step-close: ${a.nn} ${a.role} lint ok, commit ${sha}, ${keep.length} paths, ${dropped} dropped, ledger ${ledger}`;
  return { code: 0, lines: [first, ...out, `ledger: ${ledger}`, ...tail] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = close(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
