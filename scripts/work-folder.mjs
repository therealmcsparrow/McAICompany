#!/usr/bin/env node
// contract: docs/contracts/work-folder-name.md v1
// Work folder creator: `new` makes the run folder and prints its name and branch, `clear` removes a stale Topic file,
// `branch` prints the branch of an existing folder. Node built-ins only; the naming rules live in mods/lib/work-folder.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  WorkFolderRefusal, checkPlaybookId, checkWorkDirs, fallbackTopic, readTopicFile, clearTopicFile,
  candidates, stampOf, branchId, isWorkFolder,
} from '../mods/lib/work-folder.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const io = { fs, path, platform: process.platform };

const refuse = reason => {
  throw new WorkFolderRefusal(reason);
};

// Exactly the given flags, each once, each with a value: { flag: value }.
function flags(args, names) {
  if (args.length !== names.length * 2) return refuse('usage');
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || Object.hasOwn(out, args[i])) return refuse('usage');
    out[args[i]] = args[i + 1];
  }
  return out;
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function checkPlaybook(id, pluginRoot) {
  if (!checkPlaybookId(id)) refuse('bad playbook');
  const dir = lstatOrNull(path.join(pluginRoot, 'skills', id));
  const skill = lstatOrNull(path.join(pluginRoot, 'skills', id, 'SKILL.md'));
  if (!dir || dir.isSymbolicLink() || !dir.isDirectory() || !skill || skill.isSymbolicLink() || !skill.isFile()) refuse('bad playbook');
  if (fallbackTopic(id) === null) refuse('bad playbook');
}

function create(args, { root, now, pluginRoot }) {
  const { '--playbook': id, '--topic': mode } = flags(args, ['--playbook', '--topic']);
  checkPlaybook(id, pluginRoot);
  if (mode !== 'file' && mode !== 'none') refuse('usage');
  const { topic } = readTopicFile(io, root, id, mode);
  const { work } = checkWorkDirs(io, root);
  const taken = new Set(fs.readdirSync(work).map(branchId).filter(Boolean));
  for (const name of candidates(stampOf(now), topic ?? fallbackTopic(id))) {
    if (taken.has(branchId(name))) continue;
    try {
      fs.mkdirSync(path.join(work, name));
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    return { code: 0, lines: [`name: ${name}`, `branch: aico/${branchId(name)}`] };
  }
  return refuse('too many runs this minute');
}

function clear(args, { root }) {
  const { '--playbook': id } = flags(args, ['--playbook']);
  return { code: 0, lines: [clearTopicFile(io, root, id)] };
}

function branch(args, { root }) {
  if (args.length !== 1) refuse('usage');
  const name = args[0];
  if (!isWorkFolder(name)) refuse('bad name');
  const { work } = checkWorkDirs(io, root);
  const st = lstatOrNull(path.join(work, name));
  if (!st || st.isSymbolicLink() || !st.isDirectory()) refuse('unknown name');
  return { code: 0, lines: [`branch: aico/${branchId(name)}`] };
}

export function main(args, { root = process.cwd(), now = new Date(), pluginRoot = PLUGIN_ROOT } = {}) {
  try {
    const env = { root, now, pluginRoot };
    if (args[0] === 'new') return create(args.slice(1), env);
    if (args[0] === 'clear') return clear(args.slice(1), env);
    if (args[0] === 'branch') return branch(args.slice(1), env);
    return refuse('usage');
  } catch (error) {
    if (error instanceof WorkFolderRefusal) return { code: 3, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
