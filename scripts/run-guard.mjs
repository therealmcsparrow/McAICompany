#!/usr/bin/env node
// Run guard (contract: docs/contracts/run-guard.md v1.3). Node built-ins only; cwd = product root. Read-only.
// uses: docs/contracts/plan-tasks.md v1.3 docs/contracts/worktree.md v1.1 docs/contracts/run-state.md v2.0 docs/contracts/work-folder-name.md v3.0
// Prints the two Ship Gate guardrail lines as counts. Records are read only through readParallel, readWorktrees and
// run-state show; record text never reaches the output, only a cut, escaped reader message when a record is broken.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readParallel, ParallelRecordError } from './plan-tasks.mjs';
import { readWorktrees, WorktreeRecordError } from './worktree.mjs';
import { show } from './run-state.mjs';
import { isRunSlug, workParts, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MAX_ARG_CHARS = 4096;
const MAX_MESSAGE_CHARS = 120;
const USAGE = 'usage: run-guard gate <work folder>';

class Refusal extends Error {}

// Control characters print as \u{hex}; the result is cut at MAX_MESSAGE_CHARS characters.
function safeMessage(error) {
  const known = error instanceof ParallelRecordError || error instanceof WorktreeRecordError;
  const text = known && typeof error.message === 'string' ? error.message : 'unreadable';
  let out = '';
  for (const ch of text) {
    const piece = CONTROLS.test(ch) ? `\\u{${ch.codePointAt(0).toString(16)}}` : ch;
    if (out.length + piece.length > MAX_MESSAGE_CHARS) return `${out}...`;
    out += piece;
  }
  return out;
}

function filesLine(root, slug) {
  let parallel;
  let trees;
  try {
    parallel = readParallel(root, slug);
    trees = readWorktrees(root, slug);
  } catch (error) {
    return `guardrail files: unknown (${safeMessage(error)})`;
  }
  const out = parallel.state === 'on' ? parallel.out : 0;
  const sibling = parallel.state === 'on' ? parallel.sibling : 0;
  return `guardrail files: ${sibling} sibling, ${out - sibling} extra, ${trees.archived} archived, ${trees.conflicts} conflicts`;
}

function handoverLine(root, slug) {
  let steps;
  try {
    steps = show(root, slug).steps;
  } catch (error) {
    return `guardrail handover: unknown (${safeMessage(error)})`;
  }
  return `guardrail handover: ${steps.filter((s) => s.status === 'handover').length} of ${steps.length} Steps`;
}

function cmdGate(rest, env) {
  if (rest.length !== 1 || !isRunSlug(rest[0])) throw new Refusal(rest.length === 1 ? 'bad slug' : USAGE);
  const slug = rest[0];
  try { exactWorkPath({ fs, path }, env.root, workParts(slug)); } catch (e) {
    if (e instanceof WorkFolderRefusal) throw new Refusal(e.message);
    throw e;
  }
  return { code: 0, lines: [filesLine(env.root, slug), handoverLine(env.root, slug)] };
}

export function main(args, { root } = {}) {
  const env = { root: typeof root === 'string' && root !== '' ? root : process.cwd() };
  try {
    const list = Array.isArray(args) ? args : [];
    for (const arg of list) {
      if (typeof arg !== 'string') throw new Refusal(USAGE);
      if (CONTROLS.test(arg)) throw new Refusal('argument holds a control character');
      if (arg.length > MAX_ARG_CHARS) throw new Refusal('argument too long');
    }
    const [command, ...rest] = list;
    if (command !== 'gate') throw new Refusal(USAGE);
    return cmdGate(rest, env);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

function isMainReal() {
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || isMainReal())) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
