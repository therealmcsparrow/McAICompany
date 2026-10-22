#!/usr/bin/env node
// Resolves and stores the language aico writes in (a BCP 47 tag).
// User default: <home>/config.json key aico_language.
// Project override: one `aico_language: <tag>` line in the header of .company/project.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY = 'aico_language';
const MAX_TAG = 35;
const TAG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const MAX_FILE_BYTES = 1024 * 1024;
const USAGE = 'usage: language.mjs [--default | set <tag> [project] | clear [project]]';

class Refusal extends Error {}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

export function validate(input) {
  if (typeof input !== 'string' || input.length > MAX_TAG || !TAG_PATTERN.test(input)) {
    return { ok: false, tag: null, reason: 'invalid', echo: false };
  }
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(input)[0];
  } catch {
    return { ok: false, tag: null, reason: 'not a BCP 47 tag', echo: true };
  }
  if (typeof canonical !== 'string' || !TAG_PATTERN.test(canonical)) {
    return { ok: false, tag: null, reason: 'not a BCP 47 tag', echo: true };
  }
  let name;
  try {
    name = displayNames.of(canonical.split('-')[0]);
  } catch {
    name = undefined;
  }
  if (!name) return { ok: false, tag: null, reason: 'unknown language', echo: true };
  return { ok: true, tag: canonical, reason: null };
}

function homeDir(home) {
  if (home) return home;
  if (process.env.MCSPARROW_HOME) return process.env.MCSPARROW_HOME;
  return path.join(os.homedir(), '.mcsparrow');
}

const configPath = (home) => path.join(homeDir(home), 'config.json');
const projectPath = (cwd) => path.join(cwd ?? process.cwd(), '.company', 'project.md');

function readBounded(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_FILE_BYTES) throw new Refusal(`${file} is too large`);
  return fs.readFileSync(file, 'utf8');
}

// Returns the parsed config object, {} when the file is missing, or throws Refusal.
function readConfig(file) {
  const text = readBounded(file);
  if (text === null) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal(`${file} is not valid JSON`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Refusal(`${file} is not valid JSON`);
  }
  return data;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function warn(message) {
  process.stderr.write(`warning: ${message}\n`);
}

function userValue(home) {
  const file = configPath(home);
  let data;
  try {
    data = readConfig(file);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    warn(error.message);
    return null;
  }
  if (!Object.hasOwn(data, KEY)) return null;
  const checked = validate(data[KEY]);
  if (!checked.ok) {
    warn(`ignoring stored ${KEY} in ${file}`);
    return null;
  }
  return checked.tag;
}

// The header block is everything before the first `## ` heading.
function headerEnd(lines) {
  const at = lines.findIndex((line) => line.startsWith('## '));
  return at === -1 ? lines.length : at;
}

function projectValue(cwd) {
  const file = projectPath(cwd);
  let text;
  try {
    text = readBounded(file);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    warn(error.message);
    return null;
  }
  if (text === null) return null;
  const lines = text.split(/\r?\n/);
  const end = headerEnd(lines);
  for (let i = 0; i < end; i++) {
    if (!lines[i].startsWith(`${KEY}:`)) continue;
    const checked = validate(lines[i].slice(KEY.length + 1).trim());
    if (!checked.ok) {
      warn(`ignoring ${KEY} in ${file}`);
      return null;
    }
    return checked.tag;
  }
  return null;
}

export function resolve({ home, cwd, ignoreProject = false } = {}) {
  if (!ignoreProject) {
    const fromProject = projectValue(cwd);
    if (fromProject) return { tag: fromProject, source: 'project' };
  }
  const fromUser = userValue(home);
  if (fromUser) return { tag: fromUser, source: 'user' };
  return { tag: 'en', source: 'default' };
}

function refuseInvalid(input) {
  const checked = validate(input);
  if (checked.ok) return checked.tag;
  const shown = checked.echo ? input : '<invalid input>';
  const reason = checked.echo ? checked.reason : 'not a BCP 47 tag';
  throw new Refusal(`${shown}: ${reason}`);
}

function readProject(cwd) {
  const text = readBounded(projectPath(cwd));
  if (text === null) throw new Refusal('no .company/project.md');
  return text;
}

function lineBreak(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function setLanguage(tag, scope = 'user', { home, cwd } = {}) {
  if (scope !== 'user' && scope !== 'project') throw new Refusal(USAGE);
  const canonical = refuseInvalid(tag);
  if (scope === 'user') {
    const file = configPath(home);
    const data = readConfig(file);
    data[KEY] = canonical;
    writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    return canonical;
  }
  const text = readProject(cwd);
  const eol = lineBreak(text);
  const lines = text.split(/\r?\n/);
  const end = headerEnd(lines);
  const line = `${KEY}: ${canonical}`;
  const existing = lines.findIndex((l, i) => i < end && l.startsWith(`${KEY}:`));
  if (existing !== -1) {
    lines[existing] = line;
  } else {
    const after = lines.findIndex((l, i) => i < end && l.startsWith('languages:'));
    if (after !== -1) {
      lines.splice(after + 1, 0, line);
    } else {
      let last = -1;
      for (let i = 0; i < end; i++) if (/^[a-z_]+:/.test(lines[i])) last = i;
      lines.splice(last + 1, 0, line);
    }
  }
  writeAtomic(projectPath(cwd), lines.join(eol));
  return canonical;
}

export function clearLanguage(scope = 'user', { home, cwd } = {}) {
  if (scope !== 'user' && scope !== 'project') throw new Refusal(USAGE);
  if (scope === 'user') {
    const file = configPath(home);
    const data = readConfig(file);
    if (Object.hasOwn(data, KEY)) {
      delete data[KEY];
      writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    return;
  }
  const text = readProject(cwd);
  const eol = lineBreak(text);
  const lines = text.split(/\r?\n/);
  const end = headerEnd(lines);
  const kept = lines.filter((l, i) => !(i < end && l.startsWith(`${KEY}:`)));
  if (kept.length !== lines.length) writeAtomic(projectPath(cwd), kept.join(eol));
}

// Returns { code, out }.
export function run(args, { home, cwd } = {}) {
  try {
    if (args.length === 0) {
      const { tag, source } = resolve({ home, cwd });
      return { code: 0, out: `${tag}\t${source}` };
    }
    const [command, ...rest] = args;
    if (command === '--default' && rest.length === 0) {
      const { tag, source } = resolve({ home, cwd, ignoreProject: true });
      return { code: 0, out: `${tag}\t${source}` };
    }
    if (command === 'set' && (rest.length === 1 || (rest.length === 2 && rest[1] === 'project'))) {
      const scope = rest[1] ?? 'user';
      const tag = setLanguage(rest[0], scope, { home, cwd });
      return { code: 0, out: `set ${scope} ${tag}` };
    }
    if (command === 'clear' && (rest.length === 0 || (rest.length === 1 && rest[0] === 'project'))) {
      const scope = rest[0] ?? 'user';
      clearLanguage(scope, { home, cwd });
      return { code: 0, out: `cleared ${scope}` };
    }
    throw new Refusal(USAGE);
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, out: `refused: ${error.message}` };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(`${out}\n`);
  process.exitCode = code;
}
