#!/usr/bin/env node
// contract: docs/contracts/work-folder-name.md v2.1
// Work folder creator: `new` makes a project's run folder and prints its ID, name and branch, `siblings` links split
// projects, `clear` removes a stale Topic file, `branch` prints the branch of an existing folder. Node built-ins only; the naming rules live in mods/lib/work-folder.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  WorkFolderRefusal, checkPlaybookId, checkWorkDirs, fallbackTopic, readTopicFile, clearTopicFile,
  checkDescription, isProjectId, makeProject, makeRun, linkSiblings, branchId, isRunSlug, workParts, exactWorkPath,
  makeProjectV3, makeRunV3,
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

function created(id, name) {
  return { code: 0, lines: [`id: ${id}`, `name: ${name}`, `branch: aico/${branchId(name)}`] };
}

// Takes `--layout v3` out of the arguments (once, with exactly that value). Returns { v3, rest }.
function layoutOf(args) {
  const at = args.indexOf('--layout');
  if (at < 0) return { v3: false, rest: args };
  if (args.indexOf('--layout', at + 1) >= 0 || args[at + 1] !== 'v3') return refuse('usage');
  return { v3: true, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

function create(argv, { root, now, pluginRoot }) {
  const { v3, rest: args } = layoutOf(argv);
  if (args.includes('--project')) {
    const { '--playbook': id, '--project': project } = flags(args, ['--playbook', '--project']);
    checkPlaybook(id, pluginRoot);
    if (!isProjectId(project)) refuse('bad project');
    if (v3) return created(project, makeRunV3(io, root, project, now, id));
    return created(project, makeRun(io, root, project, now, 'later', id));
  }
  const { '--playbook': id, '--topic': mode } = flags(args, ['--playbook', '--topic']);
  checkPlaybook(id, pluginRoot);
  if (mode !== 'file' && mode !== 'none') refuse('usage');
  const { topic } = readTopicFile(io, root, id, mode, checkDescription);
  const made = (v3 ? makeProjectV3 : makeProject)(io, root, now, topic ?? fallbackTopic(id), id);
  return created(made.id, made.name);
}

function siblings(args, { root }) {
  if (args.length < 2 || args.length > 20) refuse('usage');
  return { code: 0, lines: [`linked: ${linkSiblings(io, root, args).join(' ')}`] };
}

function clear(args, { root }) {
  const { '--playbook': id } = flags(args, ['--playbook']);
  return { code: 0, lines: [clearTopicFile(io, root, id)] };
}

function branch(args, { root }) {
  if (args.length !== 1) refuse('usage');
  const name = args[0];
  if (!isRunSlug(name)) refuse('bad name');
  const parts = workParts(name);
  const { work } = checkWorkDirs(io, root);
  if (exactWorkPath(io, root, parts) === 'missing') refuse('unknown name');
  const st = lstatOrNull(path.join(work, ...parts));
  if (!st || st.isSymbolicLink() || !st.isDirectory()) refuse('unknown name');
  return { code: 0, lines: [`branch: aico/${branchId(name)}`] };
}

export function main(args, { root = process.cwd(), now = new Date(), pluginRoot = PLUGIN_ROOT } = {}) {
  try {
    const env = { root, now, pluginRoot };
    if (args[0] === 'new') return create(args.slice(1), env);
    if (args[0] === 'siblings') return siblings(args.slice(1), env);
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
