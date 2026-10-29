#!/usr/bin/env node
// Writes .company/project.md for a new product from checked answers.
//   write <answers.json>
// The answers file is untrusted: size capped before JSON.parse, keys read with Object.hasOwn from a fixed set,
// every value one line of 1-200 characters from an allow-list of characters. Nothing is merged into another
// object. A refusal names the key, never the value. The file is created, never replaced.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from './company-type.mjs';
import { validate as validateLanguage } from './language.mjs';

const DEFAULT_PLUGIN_ROOT = path.join(import.meta.dirname, '..');
const TEMPLATE_PATH = ['skills', 'lead', 'references', 'project-template.md'];
const ANSWERS_MAX = 32 * 1024;
const TEMPLATE_MAX = 64 * 1024;
const VALUE_MAX = 200;
const PERSONAS_MAX = 5;
const LANGUAGES_MAX = 8;
const USAGE = 'usage: project-init.mjs write <answers.json>';

// The template's one-line keys, without the fixed standards line, in file order.
export const KEYS = Object.freeze([
  'product_type', 'engagement', 'client', 'audience', 'goal', 'stack', 'languages', 'voice', 'license', 'jurisdiction'
]);
const ENUMS = Object.freeze({
  __proto__: null,
  product_type: ['web', 'desktop', 'game'],
  engagement: ['own', 'client'],
  voice: ['clear', 'bold', 'technical']
});
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
// C0, DEL, C1, Arabic letter mark, zero-width and bidi marks and controls, line and paragraph separators,
// word joiner range, byte order mark.
const BAD_CHAR_RE = new RegExp("[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]");

class Refusal extends Error {}
const refuse = message => new Refusal(message);

function oneLine(key, value) {
  const ok = typeof value === 'string'
    && value.isWellFormed()
    && value.length <= VALUE_MAX * 2
    && [...value].length >= 1
    && [...value].length <= VALUE_MAX
    && !BAD_CHAR_RE.test(value)
    && !value.includes('<!--')
    && !value.includes('-->')
    && value.trim() === value;
  if (!ok) throw refuse(`${key} must be one line of 1 to ${VALUE_MAX} characters, with no control characters, no leading or trailing space and no comment marks`);
  return value;
}

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// Reads at most `max` bytes of a plain file; null when absent. Links and other file kinds are refused.
function readPlain(file, max, what) {
  const st = lstat(file);
  if (st === null) return null;
  if (!st.isFile() || st.isSymbolicLink()) throw refuse(`${what} is not a plain file`);
  if (st.size > max) throw refuse(`${what} is larger than ${max / 1024} KiB`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > max) throw refuse(`${what} is not a plain file within ${max / 1024} KiB`);
    const buf = Buffer.alloc(max + 1);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, null);
      if (n === 0) break;
      got += n;
    }
    if (got > max) throw refuse(`${what} is larger than ${max / 1024} KiB`);
    return buf.toString('utf8', 0, got);
  } finally {
    fs.closeSync(fd);
  }
}

function parseAnswers(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw refuse('answers file is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw refuse('answers file must be a JSON object');
  return data;
}

function languagesValue(raw) {
  oneLine('languages', raw);
  const tags = raw.split(',').map(t => t.trim());
  if (tags.length > LANGUAGES_MAX || new Set(tags).size !== tags.length) throw refuse('languages must list 1 to 8 different language tags');
  const out = tags.map(tag => {
    const checked = validateLanguage(tag);
    if (!checked.ok) throw refuse('languages holds a value that is not a language tag');
    return checked.tag;
  });
  return out.join(', ');
}

// Returns { values, personas, companyType } or throws a Refusal that names the key.
export function check(data, { pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const allowed = new Set([...KEYS, 'personas', 'company_type']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw refuse(`unknown key (${[...key].length} characters, not shown)`);
  const values = {};
  for (const key of KEYS) {
    if (!Object.hasOwn(data, key)) throw refuse(`${key} is missing`);
    const raw = data[key];
    if (key === 'languages') {
      values[key] = languagesValue(raw);
    } else if (Object.hasOwn(ENUMS, key)) {
      oneLine(key, raw);
      if (!ENUMS[key].includes(raw)) throw refuse(`${key} must be one of ${ENUMS[key].join(', ')}`);
      values[key] = raw;
    } else {
      values[key] = oneLine(key, raw);
    }
  }
  if (!Object.hasOwn(data, 'personas')) throw refuse('personas is missing');
  const list = data.personas;
  if (!Array.isArray(list) || list.length > PERSONAS_MAX) throw refuse(`personas must be a list of 0 to ${PERSONAS_MAX} lines`);
  const personas = list.map(p => oneLine('personas', p));
  let companyType = null;
  if (Object.hasOwn(data, 'company_type')) {
    const id = oneLine('company_type', data.company_type);
    const registry = loadRegistry(pluginRoot);
    if (!ID_RE.test(id) || !Object.hasOwn(registry, id)) throw refuse(`company_type must be one of ${Object.keys(registry).join(', ')}`);
    companyType = id;
  }
  return { values, personas, companyType };
}

// Fills the template: each header key line is replaced, the Personas placeholder is replaced when there are any.
function render({ values, personas, companyType }, template) {
  const lines = template.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let section = '';
  let inComment = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const visible = !inComment;
    if (line.includes('<!--') && !line.includes('-->')) inComment = true;
    else if (inComment && line.includes('-->')) inComment = false;
    if (line.startsWith('## ')) section = line;
    const key = visible ? /^([a-z_]+):/.exec(line)?.[1] : undefined;
    if (section === '' && key !== undefined && Object.hasOwn(values, key)) {
      if (key === 'product_type' && companyType !== null) out.push(`company_type: ${companyType}`);
      out.push(`${key}: ${values[key]}`);
      seen += 1;
    } else if (section === '## Personas' && personas.length > 0 && line.startsWith('- ')) {
      for (const p of personas) out.push(`- ${p}`);
    } else {
      out.push(line);
    }
  }
  if (seen !== KEYS.length) throw refuse('project template does not hold the expected keys');
  return out.join('\n');
}

function ensureCompanyDir(root) {
  const dir = path.join(root, '.company');
  const st = lstat(dir);
  if (st === null) {
    fs.mkdirSync(dir);
    return { dir, made: true };
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw refuse('.company is a link or not a folder');
  return { dir, made: false };
}

// Creates the file; an existing file or link is never replaced (the hard link fails when the name is taken).
function createNew(dir, name, text) {
  const file = path.join(dir, name);
  if (lstat(file) !== null) throw refuse('.company/project.md already exists; nothing written');
  const tmp = path.join(dir, `.${name}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx', encoding: 'utf8' });
    try {
      fs.linkSync(tmp, file);
    } catch (error) {
      if (error.code === 'EEXIST') throw refuse('.company/project.md already exists; nothing written');
      throw error;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function write(answersPath, { cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const text = readPlain(path.resolve(cwd, answersPath), ANSWERS_MAX, 'answers file');
  if (text === null) throw refuse('answers file not found');
  const checked = check(parseAnswers(text), { pluginRoot });
  const template = readPlain(path.join(pluginRoot, ...TEMPLATE_PATH), TEMPLATE_MAX, 'project template');
  if (template === null) throw refuse('project template not found');
  const body = render(checked, template);
  const file = path.join(cwd, '.company', 'project.md');
  if (lstat(file) !== null) throw refuse('.company/project.md already exists; nothing written');
  const { dir, made } = ensureCompanyDir(cwd);
  try {
    createNew(dir, 'project.md', body.endsWith('\n') ? body : `${body}\n`);
  } catch (error) {
    if (made) {
      try { fs.rmdirSync(dir); } catch { /* not empty */ }
    }
    throw error;
  }
}

// Returns { code, out }.
export function run(args, { cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  try {
    if (!Array.isArray(args) || args.length !== 2 || args[0] !== 'write' || typeof args[1] !== 'string' || args[1] === '') throw refuse(USAGE);
    write(args[1], { cwd, pluginRoot });
    return { code: 0, out: 'wrote .company/project.md' };
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, out: `refused: ${error.message}` };
    return { code: 3, out: 'refused: could not write .company/project.md' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(`${out}\n`);
  process.exitCode = code;
}
