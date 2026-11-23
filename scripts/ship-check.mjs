#!/usr/bin/env node
// ship-check (contract: docs/contracts/ship-check.md v1.0, plan task T27). Node built-ins only.
// One command runs every Ship Gate check in a fixed order and prints one block. Each check is a child process of a sibling
// script with fixed arguments (argv arrays, never a shell). Arguments are untrusted; child output is cleaned before it is printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isRunSlug } from '../mods/lib/work-folder.mjs';

const HERE = import.meta.dirname;
const TIMEOUT_MS = 60000;
const MAX_BUF = 4 * 1024 * 1024;
const MAX_EXTRA = 5;
const MAX_LINE = 200;
const BAD_CHARS = /["'`$\\*?[\u0000-\u001f\u007f]/u;
const BASE_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH_RE = /^aico\/[A-Za-z0-9._-]{1,100}$/;
const BASELINE_RE = /^[A-Za-z0-9._/-]{1,60}(?:,[A-Za-z0-9._/-]{1,60}){2}$/;
const USAGE = 'usage: ship-check <slug> --base <full id> --branch <branch> [--acs <n>] [--baseline <run>,<run>,<run>]';

class Refusal extends Error {}

export function parseArgs(argv) {
  const [slug, ...rest] = argv;
  if (typeof slug !== 'string' || !isRunSlug(slug)) throw new Refusal('slug');
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (!['--base', '--branch', '--acs', '--baseline'].includes(k) || typeof v !== 'string' || Object.hasOwn(opts, k)) throw new Refusal(USAGE);
    opts[k] = v;
  }
  if (!BASE_RE.test(opts['--base'] ?? '')) throw new Refusal('--base');
  if (!BRANCH_RE.test(opts['--branch'] ?? '') || opts['--branch'].includes('..')) throw new Refusal('--branch');
  if (Object.hasOwn(opts, '--acs') && !/^[1-9]\d{0,2}$/.test(opts['--acs'])) throw new Refusal('--acs');
  if (Object.hasOwn(opts, '--baseline') && !BASELINE_RE.test(opts['--baseline'])) throw new Refusal('--baseline');
  return { slug, base: opts['--base'], branch: opts['--branch'], acs: opts['--acs'], baseline: opts['--baseline'] };
}

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LINE);

function child(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUF, windowsHide: true });
  if (r.error || r.status === null) return { failed: true, code: null, lines: [] };
  const lines = `${r.stdout ?? ''}`.split(/\r?\n/).map(clean).filter(Boolean);
  return { failed: false, code: r.status, lines };
}

const node = (script, args, cwd) => child(process.execPath, [path.join(HERE, `${script}.mjs`), ...args], cwd);
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUF, windowsHide: true });
  return { failed: !!r.error || r.status === null, code: r.status, out: r.stdout ?? '' };
};

// A check result: { kind: 'ok'|'block'|'info', text, extra[] }.
const res = (kind, text = '', extra = []) => ({ kind, text, extra: extra.slice(0, MAX_EXTRA) });
const COULD_NOT = res('block', 'could not run');
const firstOr = (lines, d) => lines[0] ?? d;

function checkTree(a, cwd) {
  const problems = [];
  const head = git(['symbolic-ref', '-q', 'HEAD'], cwd);
  const st = git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=none'], cwd);
  if (head.failed || st.failed) return COULD_NOT;
  if (head.code !== 0 || head.out.trim() !== `refs/heads/${a.branch}`) problems.push(`HEAD is not ${a.branch}`);
  if (st.code !== 0) problems.push('git status failed');
  else if (st.out.length > 0) problems.push(`${st.out.split('\0').filter(Boolean).length} tracked change(s)`);
  const un = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  const files = un.code === 0 ? un.out.split('\0').filter(Boolean) : [];
  const shown = files.filter((p) => !path.isAbsolute(p) && !p.split('/').includes('..') && !BAD_CHARS.test(p)).slice(0, MAX_EXTRA).map(clean);
  if (problems.length) return res('block', problems.join('; '), files.length ? [`${files.length} untracked`] : []);
  return files.length ? res('info', `${files.length} untracked`, shown) : res('ok');
}

function checkContests(a, cwd) {
  const r = node('handoff-lint', ['--contests', path.join('.company', 'work', a.slug)], cwd);
  if (r.failed) return COULD_NOT;
  const bad = r.lines.filter((l) => /^(unresolved|escalated)\b/.test(l));
  if (bad.length) return res('block', bad[0], bad.slice(1));
  if (r.code !== 0) return res('block', firstOr(r.lines, `exit ${r.code}`), r.lines.slice(1));
  return res('ok');
}

function checkDrift(a, cwd) {
  const r = node('rule-check', ['drift'], cwd);
  if (r.failed) return COULD_NOT;
  return r.code === 1 ? res('block', firstOr(r.lines, 'drift found'), r.lines.slice(1)) : res('ok');
}

function checkLedger(a, cwd) {
  const rec = node('ledger', ['reconcile', a.slug], cwd);
  const rep = node('ledger', ['report', a.slug, ...(a.baseline ? ['--baseline', a.baseline] : []), ...(a.acs ? ['--acs', a.acs] : [])], cwd);
  if (rec.failed || rep.failed) return COULD_NOT;
  const lines = rep.lines.length ? rep.lines : rec.lines;
  return lines.length ? res('info', lines[0], lines.slice(1)) : res('ok');
}

function checkReviewLoop(a, cwd) {
  const r = node('review-loop', ['gate', a.slug], cwd);
  if (r.failed) return COULD_NOT;
  const bad = r.lines.filter((l) => /^blocking\b/i.test(l));
  if (bad.length) return res('block', bad[0], bad.slice(1));
  if (r.code !== 0) return res('block', firstOr(r.lines, `exit ${r.code}`), r.lines.slice(1));
  return res('ok');
}

function checkTier(a, cwd) {
  const sync = node('tier-set', ['sync', a.slug, '--diff', '--base', a.base], cwd);
  const owed = node('route', ['owed', a.slug], cwd);
  if (sync.failed || owed.failed) return COULD_NOT;
  const causes = [];
  const add = sync.lines.find((l) => /^add before ship:/.test(l));
  if (add) causes.push(add);
  if (sync.code !== 0) causes.push(`tier-set sync exit ${sync.code}`);
  const o = owed.lines.map((l) => /^owed: (\S+)/.exec(l)).find(Boolean);
  if (owed.code !== 0) causes.push(`route owed exit ${owed.code}`);
  else if (o && o[1] === 'security') causes.push('owed: security');
  if (causes.length) return res('block', causes[0], causes.slice(1));
  return res('info', sync.lines.find((l) => /^tier/.test(l)) ?? firstOr(sync.lines, 'no tier line'));
}

function checkLead(a, cwd) {
  const r = node('lead-handover', ['read', a.slug], cwd);
  if (r.failed) return COULD_NOT;
  const peak = r.lines.find((l) => /lead peak/i.test(l));
  return peak ? res('info', peak) : res('ok');
}

// pipeline.worktrees is a user-level key (aico-settings v4.0): read it from the user config; absent or unreadable means off.
// Read directly, not through settings.mjs, so a bad project layer or a sibling import cannot stop the check.
function worktreesOn() {
  const home = process.env.MCSPARROW_HOME || path.join(os.homedir(), '.mcsparrow');
  try {
    const file = path.join(home, 'config.json');
    if (fs.statSync(file).size > 1048576) return false;
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.pipeline?.worktrees === 'on';
  } catch { return false; }
}

function checkWorktrees(a, cwd) {
  const on = worktreesOn();
  if (!on) return res('info', 'off');
  const bad = [];
  for (const [s, args] of [['worktree', ['leftovers']], ['run-guard', ['gate', a.slug]], ['worktree', ['protocheck', a.slug]]]) {
    const r = node(s, args, cwd);
    if (r.failed) return COULD_NOT;
    const b = r.lines.filter((l) => /^blocking\b/i.test(l));
    if (b.length) bad.push(...b);
    else if (r.code !== 0) bad.push(firstOr(r.lines, `${s} ${args[0]} exit ${r.code}`));
  }
  return bad.length ? res('block', bad[0], bad.slice(1)) : res('ok');
}

const CHECKS = [['tree', checkTree], ['contests', checkContests], ['drift', checkDrift], ['ledger', checkLedger], ['review-loop', checkReviewLoop], ['tier', checkTier], ['lead', checkLead], ['worktrees', checkWorktrees]];

export function main(argv, cwd = process.cwd()) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    if (e instanceof Refusal) return { code: 2, lines: [`refused: ${e.message}`] };
    throw e;
  }
  const lines = [];
  let blocks = 0;
  let infos = 0;
  for (const [name, fn] of CHECKS) {
    let r;
    try { r = fn(a, cwd); } catch { r = COULD_NOT; }
    if (r.kind === 'block') blocks++;
    // `worktrees: off` is the one line without a dash and is not counted as info.
    const off = name === 'worktrees' && r.kind === 'info' && r.text === 'off';
    if (r.kind === 'info' && !off) infos++;
    lines.push(off ? 'worktrees: off' : r.kind === 'ok' ? `${name}: ok` : `${name}: ${r.kind} — ${r.text}`);
    for (const e of r.extra) lines.push(`  ${e}`);
  }
  lines.push(`ship-check: ${blocks} blocking, ${infos} info`);
  return { code: blocks ? 1 : 0, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
