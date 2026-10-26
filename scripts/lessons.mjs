#!/usr/bin/env node
// Lessons file: `accept` appends one vetted line, `list` reads the well-formed lines.
// Lessons are read back into prompts, so the text rules below are an allow-list.
// The file is <cwd>/.company/lessons.md, one line per Lesson: `- <YYYY-MM-DD> <role>: <text>`.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_FILE_BYTES = 64 * 1024;
export const MIN_TEXT = 10;
export const MAX_TEXT = 240;
export const ROLE_RE = /^(lead|[a-z][a-z0-9-]{0,40})$/;
const LINE_RE = /^- (\d{4}-\d{2}-\d{2}) (lead|[a-z][a-z0-9-]{0,40}): (\S.*)$/;
const USAGE = 'usage: lessons.mjs accept --role <role> --text <text> | list --json';

class Refusal extends Error {}

// Returns null when the text may be written, else the reason it is refused.
export function checkText(text) {
  if (typeof text !== 'string') return 'text must be a string';
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(text)) return 'text must be one line with no control character';
  const t = text.trim();
  if (t.length < MIN_TEXT || t.length > MAX_TEXT) return `text must be ${MIN_TEXT}-${MAX_TEXT} characters`;
  if (/^[-#>|]/.test(t)) return 'text must not start with -, #, > or |';
  if (t.includes('`')) return 'text must not contain a backtick';
  if (/<[A-Za-z]/.test(t)) return 'text must not contain a tag';
  return null;
}

const dirPath = () => path.join(process.cwd(), '.company');
const filePath = () => path.join(dirPath(), 'lessons.md');

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// Returns the file text ('' when absent). Refuses a symlink, a non-file and a file over the limit.
function readLessons() {
  const dir = lstatOrNull(dirPath());
  if (dir && !dir.isDirectory()) throw new Refusal('.company is not a plain folder');
  const st = lstatOrNull(filePath());
  if (!st) return '';
  if (!st.isFile()) throw new Refusal('lessons.md is not a plain file');
  if (st.size > MAX_FILE_BYTES) throw new Refusal('lessons.md is over 64 KiB');
  return fs.readFileSync(filePath(), 'utf8');
}

function parseLines(text) {
  const lessons = [];
  const warnings = [];
  text.split('\n').forEach((line, i) => {
    if (line === '') return;
    const m = LINE_RE.exec(line);
    if (m) lessons.push({ date: m[1], role: m[2], text: m[3] });
    else warnings.push(`warning: line ${i + 1} skipped`);
  });
  return { lessons, warnings };
}

function cmdAccept(args) {
  if (args.length !== 4 || args[0] !== '--role' || args[2] !== '--text') throw new Refusal(USAGE);
  const [, role, , rawText] = args;
  if (!ROLE_RE.test(role)) throw new Refusal('role must match ^(lead|[a-z][a-z0-9-]{0,40})$');
  const reason = checkText(rawText);
  if (reason) throw new Refusal(reason);
  const text = rawText.trim();
  const current = readLessons();
  const seen = parseLines(current).lessons;
  if (seen.some((l) => l.role === role && l.text.toLowerCase() === text.toLowerCase())) {
    throw new Refusal('duplicate lesson');
  }
  const today = new Date().toISOString().slice(0, 10);
  const prefix = current !== '' && !current.endsWith('\n') ? '\n' : '';
  const line = `${prefix}- ${today} ${role}: ${text}\n`;
  if (Buffer.byteLength(current) + Buffer.byteLength(line) > MAX_FILE_BYTES) throw new Refusal('lessons.md would pass 64 KiB');
  fs.mkdirSync(dirPath(), { recursive: true });
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(filePath(), flags, 0o644);
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
  return { out: ['accepted'], err: [] };
}

function cmdList(args) {
  if (args.length !== 1 || args[0] !== '--json') throw new Refusal(USAGE);
  const { lessons, warnings } = parseLines(readLessons());
  return { out: [JSON.stringify(lessons)], err: warnings };
}

export function main(args) {
  const [command, ...rest] = args;
  try {
    if (command === 'accept') return { code: 0, ...cmdAccept(rest) };
    if (command === 'list') return { code: 0, ...cmdList(rest) };
    throw new Refusal(USAGE);
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, out: [`refused: ${error.message}`], err: [] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, out, err } = main(process.argv.slice(2));
  if (out.length) process.stdout.write(`${out.join('\n')}\n`);
  if (err.length) process.stderr.write(`${err.join('\n')}\n`);
  process.exitCode = code;
}
