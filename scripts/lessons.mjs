#!/usr/bin/env node
// Lessons file: `accept` appends one vetted line, `list` reads the well-formed lines, `lint` checks the v2 lines.
// Lessons are read back into prompts, so the text and target rules below are allow-lists.
// The file is <cwd>/.company/lessons.md, one line per Lesson:
// v2 `- <YYYY-MM-DD> <role>: [mechanical|judgement] <text> — <target>`, v1 `- <YYYY-MM-DD> <role>: <text>` (read only).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MIN_TEXT, MAX_TEXT, TEXT_RE, checkText } from '../mods/lib/lesson-text.mjs';

export const MAX_FILE_BYTES = 64 * 1024;
export { MIN_TEXT, MAX_TEXT, TEXT_RE, checkText };
export const ROLE_RE = /^(lead|[a-z][a-z0-9-]{0,40})$/;
export const CLASSES = ['mechanical', 'judgement'];
const LINE_RE = /^- (\d{4}-\d{2}-\d{2}) (lead|[a-z][a-z0-9-]{0,40}): (\S.*)$/;
const CLASS_RE = /^\[(mechanical|judgement)\]( |$)/;
const CHECK_TARGET_RE = /^check: (script|lint|test) ([A-Za-z0-9][A-Za-z0-9._/ -]{0,79})$/;
const STANDARD_TARGET_RE = /^standard: (\.company\/standards\.md|skills\/review\/SKILL\.md|skills\/review\/references\/[a-z0-9][a-z0-9-]{0,60}\.md)$/;
const BANNED_TARGET_RE = /CLAUDE\.md|AGENTS\.md|agents\//i;
const SEP = ' — ';
const FLAGS = ['--role', '--class', '--target', '--text'];
const USAGE = 'usage: lessons.mjs accept --role <role> --class <mechanical|judgement> --target <target> --text <text> | list --json | lint';

class Refusal extends Error {}

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

// Returns null when the target fits the class, else the reason (to follow "target ").
export function checkTarget(cls, target) {
  if (typeof target !== 'string' || target === '') return 'is missing';
  if (target.length > 120) return 'is over 120 characters';
  if (BANNED_TARGET_RE.test(target)) return 'must not name CLAUDE.md, AGENTS.md or agents/';
  if (cls === 'mechanical') {
    const m = CHECK_TARGET_RE.exec(target);
    if (!m || m[2].endsWith(' ')) return 'for a mechanical lesson must be check: <script|lint|test> <name 1-80>';
    return null;
  }
  if (!STANDARD_TARGET_RE.test(target)) {
    return 'for a judgement lesson must be standard: .company/standards.md, skills/review/SKILL.md or skills/review/references/<name>.md';
  }
  return null;
}

// What follows the role: { v1 } for an unclassified line, { lesson } or { error }.
function parseBody(body) {
  const mark = CLASS_RE.exec(body);
  if (!mark) return { v1: true };
  if (mark[2] === '') return { error: 'class is not followed by text' };
  const rest = body.slice(mark[0].length);
  const at = rest.lastIndexOf(SEP);
  if (at < 0) return { error: 'target is missing (text — target)' };
  const text = rest.slice(0, at);
  const target = rest.slice(at + SEP.length);
  const reason = checkText(text);
  if (reason) return { error: reason };
  if (text !== text.trim()) return { error: 'text must not start or end with a space' };
  const bad = checkTarget(mark[1], target);
  if (bad) return { error: `target ${bad}` };
  return { lesson: { class: mark[1], target, text } };
}

function parseLines(text) {
  const lessons = [];
  const warnings = [];
  const errors = [];
  text.split('\n').forEach((line, i) => {
    if (line === '') return;
    const n = i + 1;
    const m = LINE_RE.exec(line);
    if (!m) {
      warnings.push(`warning: line ${n} skipped`);
      return;
    }
    const body = parseBody(m[3]);
    if (body.error) {
      errors.push(`ERROR line ${n}: ${body.error}`);
      warnings.push(`warning: line ${n} skipped`);
    } else if (body.v1) {
      lessons.push({ date: m[1], role: m[2], class: null, target: null, text: m[3] });
      warnings.push(`warning: line ${n} unclassified (v1)`);
    } else {
      lessons.push({ date: m[1], role: m[2], class: body.lesson.class, target: body.lesson.target, text: body.lesson.text });
    }
  });
  return { lessons, warnings, errors };
}

function parseFlags(args) {
  const got = {};
  if (args.length % 2 !== 0) throw new Refusal(USAGE);
  for (let i = 0; i < args.length; i += 2) {
    if (!FLAGS.includes(args[i]) || Object.hasOwn(got, args[i])) throw new Refusal(USAGE);
    got[args[i]] = args[i + 1];
  }
  return got;
}

function cmdAccept(args) {
  const got = parseFlags(args);
  const role = got['--role'];
  const rawText = got['--text'];
  if (role === undefined || rawText === undefined) throw new Refusal(USAGE);
  if (!ROLE_RE.test(role)) throw new Refusal('role must match ^(lead|[a-z][a-z0-9-]{0,40})$');
  const cls = got['--class'];
  if (!CLASSES.includes(cls)) throw new Refusal('lesson needs --class mechanical|judgement');
  const target = got['--target'];
  const badTarget = checkTarget(cls, target);
  if (badTarget) throw new Refusal(`lesson target ${badTarget}`);
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
  const line = `${prefix}- ${today} ${role}: [${cls}] ${text}${SEP}${target}\n`;
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

function cmdLint(args) {
  if (args.length !== 0) throw new Refusal(USAGE);
  const { errors, warnings } = parseLines(readLessons());
  return { code: errors.length > 0 ? 2 : 0, out: [...errors, `lessons: ${errors.length} errors`], err: warnings };
}

export function main(args) {
  const [command, ...rest] = args;
  try {
    if (command === 'accept') return { code: 0, ...cmdAccept(rest) };
    if (command === 'list') return { code: 0, ...cmdList(rest) };
    if (command === 'lint') return { code: 0, ...cmdLint(rest) };
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
