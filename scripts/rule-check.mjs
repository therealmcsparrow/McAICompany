#!/usr/bin/env node
// Tool checks bound to ruleset rules by ID (contract: docs/contracts/rule-check.md v1). Node built-ins only.
// Rule text is data: it is printed and hashed, never run or put into a command (agentsec.M-SEC7).
// Tools run with spawnSync and an argument array, never through a shell (node.M-SEC1).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const KiB = 1024;
const MiB = 1024 * KiB;
const MAX_CHECKS_BYTES = 64 * KiB;
const MAX_TEXT_BYTES = 256 * KiB;
const MAX_SCAN_BYTES = 64 * MiB;
const MAX_OUTPUT = MiB;
const TOOL_TIMEOUT_MS = 120000;
const NODE_TEST_TIMEOUT_MS = 300000;
const CUT = 120;

const RULE_ID = /^[a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+$/;
const RULE_LINE = /^- ([a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+) — (.*)$/;
const RULE_ID_ANY = /[a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+/g;
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const BASE = /^[0-9a-f]{7,40}$/;
const HASH = /^[0-9a-f]{64}$/;
const MARKERS = [' — why: ', ' — source: ', ' — enforced-by: ', ' — check: '];
const BUILTINS = new Set(['aico-check', 'lf', 'node-test', 'handoff-lint']);
const PACK_SECTIONS = new Set(['Must', 'Should', 'May', 'Security']);
const GITATTRIBUTES_LINE = '* text=auto eol=lf';
const USAGE = [
  'usage: rule-check.mjs <command> [--root <dir>]',
  '  run --base <sha> [--handoff <file>]',
  '  list',
  '  slices <senior-engineer handoff>',
  '  drift'
].join('\n');

class Refusal extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

class ConfigError extends Refusal {
  constructor(reason) {
    super(`tool config invalid: ${reason}`);
    this.reason = reason;
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------- ruleset ----------

export function parseRuleLine(line) {
  const m = RULE_LINE.exec(line);
  if (!m) return null;
  const rest = m[2];
  let end = rest.length;
  for (const marker of MARKERS) {
    const i = rest.indexOf(marker);
    if (i !== -1 && i < end) end = i;
  }
  const at = rest.indexOf(MARKERS[3]);
  const check = at === -1 ? null : rest.slice(at + MARKERS[3].length).trim();
  return { id: m[1], text: rest.slice(0, end), check };
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readCapped(file, cap, label) {
  const size = fs.statSync(file).size;
  if (size > cap) throw new Refusal(`${label} too large`);
  return fs.readFileSync(file, 'utf8');
}

function sections(text) {
  const out = [];
  let name = '';
  for (const line of text.split(/\r?\n/)) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) name = h[1];
    else out.push({ section: name, line });
  }
  return out;
}

// Rules in force: the Project rules of standards.md first, then the committed packs.
function loadRules(root) {
  const rules = new Map();
  const security = new Set();
  const dir = path.join(root, '.company');
  for (const { section, line } of sections(readCapped(path.join(dir, 'standards.md'), MAX_TEXT_BYTES, 'standards.md'))) {
    if (section !== 'Project rules') continue;
    const r = parseRuleLine(line);
    if (!r || rules.has(r.id)) continue;
    rules.set(r.id, { ...r, project: true });
    if (r.id.includes('-SEC')) security.add(r.id);
  }
  const packDir = path.join(dir, 'standards');
  const files = fs.existsSync(packDir) ? fs.readdirSync(packDir).filter(f => /^[^@/\\]+@[^/\\]+\.md$/.test(f)).sort() : [];
  for (const f of files) {
    const file = path.join(packDir, f);
    if (!isFile(file)) continue;
    for (const { section, line } of sections(readCapped(file, MAX_TEXT_BYTES, f))) {
      if (!PACK_SECTIONS.has(section)) continue;
      const r = parseRuleLine(line);
      if (!r || rules.has(r.id)) continue;
      rules.set(r.id, { ...r, check: null, project: false });
      if (section === 'Security' || r.id.includes('-SEC')) security.add(r.id);
    }
  }
  return { rules, security };
}

// ---------- bindings ----------

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadChecks(root) {
  const file = path.join(root, '.company', 'checks.json');
  if (fs.statSync(file).size > MAX_CHECKS_BYTES) throw new ConfigError('checks.json over 64 KiB');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new ConfigError('checks.json is not valid JSON');
  }
  if (!plain(data)) throw new ConfigError('checks.json is not an object');
  for (const key of Object.keys(data)) if (key !== 'version' && key !== 'checks') throw new ConfigError(`unknown key ${key.slice(0, 40)}`);
  if (data.version !== 1) throw new ConfigError('version must be 1');
  if (!plain(data.checks)) throw new ConfigError('checks must be an object');
  const out = new Map();
  for (const [id, b] of Object.entries(data.checks)) {
    if (!CHECK_ID.test(id)) throw new ConfigError('bad check id');
    if (!plain(b)) throw new ConfigError(`check ${id} is not an object`);
    for (const key of Object.keys(b)) if (key !== 'rule' && key !== 'text' && key !== 'argv') throw new ConfigError(`check ${id}: unknown key ${key.slice(0, 40)}`);
    if (typeof b.rule !== 'string' || !RULE_ID.test(b.rule)) throw new ConfigError(`check ${id}: bad rule id`);
    if (typeof b.text !== 'string' || !HASH.test(b.text)) throw new ConfigError(`check ${id}: text must be a SHA-256 hex digest`);
    let argv = null;
    if (Object.hasOwn(b, 'argv')) {
      const a = b.argv;
      if (!Array.isArray(a) || a.length < 1 || a.length > 64 || a[0] === '' || a.some(s => typeof s !== 'string' || s.length > 4096 || s.includes('\0')))
        throw new ConfigError(`check ${id}: argv must be a list of 1-64 strings`);
      argv = a;
    }
    if (BUILTINS.has(id) && argv) throw new ConfigError(`check ${id}: built-in checks take no argv`);
    if (!BUILTINS.has(id) && !argv) throw new ConfigError(`check ${id}: not built in, so argv is required`);
    out.set(id, { rule: b.rule, text: b.text, argv });
  }
  return out;
}

// ---------- tool runner ----------

function resolveCommand(file, args) {
  if (process.platform === 'win32' && (file === 'npm' || file === 'npx')) {
    // The .cmd shims cannot run without a shell; run their JS entry point with this node instead.
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${file}-cli.js`);
    if (!fs.existsSync(cli)) return null;
    return { file: process.execPath, args: [cli, ...args] };
  }
  return { file, args };
}

function runTool(file, args, { cwd, timeout }) {
  const command = resolveCommand(file, args);
  if (!command) return { failed: 'cannot find the program' };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command.file, command.args, {
    cwd, env, timeout, encoding: 'utf8', maxBuffer: MAX_OUTPUT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.error) return { failed: r.error.code ?? 'spawn error' };
  if (r.status === null) return { failed: `signal ${r.signal ?? 'unknown'}` };
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ---------- rows ----------

function clean(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\|/g, '¦').trim();
}

function cut(value, n = CUT) {
  const s = clean(value);
  return s.length > n ? s.slice(0, n) : s;
}

function row(n, file, problem, rule, fix = 'see rule') {
  const ruleCell = rule ? `${rule.id}: ${cut(rule.text)}` : 'none';
  return `T-${n} | ${clean(file)} | ${clean(problem)} | ${ruleCell} | ${clean(fix)}`;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

// ---------- built-in checks: each returns { findings: [{file, problem, fix}] } or { failed } ----------

function checkAico(ctx) {
  const r = runTool(process.execPath, [path.join(import.meta.dirname, 'check.mjs'), ctx.root], ctx);
  if (r.failed) return r;
  if (r.status !== 0 && r.status !== 1) return { failed: `exit ${r.status}` };
  const findings = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^WARN (.+): (\S+) (\d+) > (\d+) lines$/.exec(line);
    if (m) findings.push({ file: m[1], problem: `${m[2]} ${m[3]} > ${m[4]} lines`, fix: 'move detail to references/ files' });
  }
  return { findings };
}

function gitList(ctx, args) {
  const r = runTool('git', args, ctx);
  if (r.failed) return r;
  if (r.status !== 0) return { failed: `git exit ${r.status}` };
  return { out: r.out };
}

function firstCr(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(13);
  if (at === -1) return 0;
  let line = 1;
  for (let i = 0; i < at; i++) if (buf[i] === 10) line++;
  return line;
}

function checkLf(ctx) {
  const range = `${ctx.base}..HEAD`;
  const common = ['diff', '-z', '--no-renames', '--diff-filter=ACMR'];
  const names = gitList(ctx, [...common, '--name-only', range, '--']);
  if (names.failed) return names;
  const nums = gitList(ctx, [...common, '--numstat', range, '--']);
  if (nums.failed) return nums;
  const binary = new Set();
  for (const entry of nums.out.split('\0')) {
    const m = /^(\S+)\t(\S+)\t([\s\S]+)$/.exec(entry);
    if (m && m[1] === '-' && m[2] === '-') binary.add(m[3]);
  }
  const findings = [];
  for (const name of names.out.split('\0')) {
    if (!name || binary.has(name)) continue;
    const abs = path.resolve(ctx.root, name);
    const inside = path.relative(ctx.root, abs);
    if (inside.startsWith('..') || path.isAbsolute(inside)) continue;
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_SCAN_BYTES) {
      findings.push({ file: name, problem: 'too large to scan for CR bytes', fix: 'see rule' });
      continue;
    }
    const line = firstCr(abs);
    if (line) findings.push({ file: `${name}:${line}`, problem: 'CR byte in text file', fix: 'convert to LF' });
  }
  let attributes = [];
  try {
    attributes = fs.readFileSync(path.join(ctx.root, '.gitattributes'), 'utf8').split('\n').map(l => l.trim());
  } catch {
    attributes = [];
  }
  if (!attributes.includes(GITATTRIBUTES_LINE))
    findings.push({ file: '.gitattributes', problem: `missing line "${GITATTRIBUTES_LINE}"`, fix: 'restore the line' });
  return { findings };
}

function failingTestName(output) {
  for (const line of output.split(/\r?\n/)) {
    const tap = /^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(line);
    if (tap) return tap[1];
    const spec = /^\s*✖ (.+?)(?: \([\d.]+ms\))?$/.exec(line);
    if (spec && !spec[1].startsWith('failing tests')) return spec[1];
  }
  return null;
}

function checkNodeTest(ctx) {
  const r = runTool('npm', ['test'], { cwd: ctx.root, timeout: ctx.nodeTestTimeout });
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  const name = failingTestName(`${r.out}\n${r.err}`);
  return { findings: [{ file: 'package.json', problem: `npm test failed: ${name ? cut(name) : `exit ${r.status}`}`, fix: 'see rule' }] };
}

function checkHandoffLint(ctx) {
  if (!ctx.handoff) return { failed: 'no --handoff given' };
  const r = runTool(process.execPath, [path.join(import.meta.dirname, 'handoff-lint.mjs'), ctx.handoff], ctx);
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  if (r.status !== 1) return { failed: `exit ${r.status}` };
  const file = rel(ctx.root, ctx.handoff);
  const errors = r.out.split(/\r?\n/).filter(l => l.startsWith('ERROR '));
  const lines = errors.length ? errors.map(l => l.slice(6)) : ['handoff-lint exited 1'];
  return { findings: lines.map(problem => ({ file, problem, fix: 'see rule' })) };
}

function checkArgv(id, argv, ctx) {
  const r = runTool(argv[0], argv.slice(1), ctx);
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  const first = `${r.out}\n${r.err}`.split(/\r?\n/).find(l => l.trim()) ?? '';
  return { findings: [{ file: '-', problem: `${id} exited ${r.status}: ${cut(first)}`, fix: 'see rule' }] };
}

// ---------- commands ----------

function ruleset(root) {
  return {
    standards: isFile(path.join(root, '.company', 'standards.md')),
    checks: isFile(path.join(root, '.company', 'checks.json'))
  };
}

function cmdRun(a, opts) {
  const st = ruleset(a.root);
  if (!st.standards && !st.checks) return { code: 0, lines: ['no ruleset'] };
  if (!st.checks) return { code: 0, lines: ['no checks bound'] };
  if (!st.standards) return { code: 0, lines: [row(0, '.company/checks.json', 'tool config invalid: .company/standards.md is missing', null, 'restore the ruleset')] };
  let checks;
  try {
    checks = loadChecks(a.root);
  } catch (error) {
    if (error instanceof ConfigError) return { code: 2, lines: [row(0, '.company/checks.json', `tool config invalid: ${error.reason}`, null, 'fix checks.json')] };
    throw error;
  }
  const { rules } = loadRules(a.root);
  const timeout = opts.timeoutMs ?? TOOL_TIMEOUT_MS;
  const ctx = { root: a.root, cwd: a.root, base: a.base, handoff: a.handoff, timeout, nodeTestTimeout: opts.timeoutMs ?? NODE_TEST_TIMEOUT_MS };
  const lines = [];
  let n = 0;
  for (const [id, b] of checks) {
    const rule = rules.get(b.rule);
    if (!rule || sha256(rule.text) !== b.text) {
      lines.push(row(0, '.company/checks.json', `tool config invalid: binding ${id} is out of date (run drift)`, null, 'rebind the check'));
      continue;
    }
    let result;
    if (b.argv) result = checkArgv(id, b.argv, ctx);
    else if (id === 'aico-check') result = checkAico(ctx);
    else if (id === 'lf') result = checkLf(ctx);
    else if (id === 'node-test') result = checkNodeTest(ctx);
    else result = checkHandoffLint(ctx);
    if (result.failed) lines.push(row(++n, '-', `tool failed: ${id} (${result.failed})`, rule));
    else for (const f of result.findings) lines.push(row(++n, f.file, f.problem, rule, f.fix));
  }
  return { code: 0, lines };
}

function cmdList(a) {
  if (!ruleset(a.root).checks) return { code: 0, lines: [] };
  return { code: 0, lines: [...loadChecks(a.root)].map(([id, b]) => `${b.rule} ${id}`) };
}

function cmdSlices(a) {
  if (!ruleset(a.root).standards) return { code: 0, lines: ['no ruleset'] };
  const file = path.resolve(a.positional);
  if (!isFile(file)) throw new Refusal('bad handoff');
  const text = readCapped(file, MAX_TEXT_BYTES, 'handoff');
  const { security } = loadRules(a.root);
  if (!/^## Rules per task\s*$/m.test(text)) return { code: 1, lines: ['## Rules per task is missing'] };
  const body = sections(text).filter(s => s.section === 'Rules per task').map(s => s.line);
  const gaps = [];
  let tasks = 0;
  let tableRow = -1;
  for (const line of body) {
    if (!line.startsWith('|')) {
      tableRow = -1;
      continue;
    }
    tableRow++;
    if (tableRow === 0 || /^\|[\s:|-]+\|?\s*$/.test(line)) continue;
    const cells = line.split('|').slice(1, line.trimEnd().endsWith('|') ? -1 : undefined).map(c => c.trim());
    tasks++;
    const listed = new Set(cells.slice(1).join(' ').match(RULE_ID_ANY) ?? []);
    const missing = [...security].filter(id => !listed.has(id));
    if (missing.length) gaps.push(`${cut(cells[0], 40)}: missing ${missing.join(', ')}`);
  }
  if (!tasks) return { code: 1, lines: ['## Rules per task has no task lines'] };
  return { code: gaps.length ? 1 : 0, lines: gaps.length ? gaps : [`slices ok: ${tasks} task line(s)`] };
}

function cmdDrift(a) {
  const st = ruleset(a.root);
  if (!st.standards && !st.checks) return { code: 0, lines: ['no ruleset'] };
  const lines = [];
  const checks = st.checks ? loadChecks(a.root) : new Map();
  if (!st.standards) {
    for (const [id, b] of checks) lines.push(`binding ${id}: rule ${b.rule} missing (no .company/standards.md)`);
    if (!lines.length) lines.push('checks.json without standards.md');
    return { code: 1, lines };
  }
  const { rules } = loadRules(a.root);
  for (const [id, b] of checks) {
    const rule = rules.get(b.rule);
    if (!rule) {
      lines.push(`binding ${id}: rule ${b.rule} missing`);
      continue;
    }
    if (sha256(rule.text) !== b.text) lines.push(`binding ${id}: rule ${b.rule} text changed (rebind after sign-off)`);
    if (rule.project && rule.check !== id) lines.push(`binding ${id}: rule ${b.rule} does not carry check:${id}`);
  }
  for (const rule of rules.values()) {
    if (!rule.project || rule.check === null || rule.check === 'judgment') continue;
    if (!CHECK_ID.test(rule.check)) {
      lines.push(`rule ${rule.id}: invalid check tag`);
      continue;
    }
    const b = checks.get(rule.check);
    if (!b || b.rule !== rule.id) lines.push(`rule ${rule.id} carries check:${rule.check} but no binding for it`);
  }
  return { code: lines.length ? 1 : 0, lines: lines.length ? lines : ['drift ok'] };
}

// ---------- CLI ----------

function parseArgs(args) {
  const [command, ...rest] = args;
  const allowed = { run: ['--root', '--base', '--handoff'], list: ['--root'], slices: ['--root'], drift: ['--root'] };
  if (!command || !Object.hasOwn(allowed, command)) throw new Refusal(USAGE);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (!allowed[command].includes(arg) || Object.hasOwn(opts, arg) || i + 1 >= rest.length) throw new Refusal(USAGE);
      opts[arg] = rest[++i];
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== (command === 'slices' ? 1 : 0)) throw new Refusal(USAGE);
  return { command, opts, positional: positional[0] };
}

export function main(args, options = {}) {
  try {
    const { command, opts, positional } = parseArgs(args);
    const base = opts['--base'];
    if (command === 'run' && !(typeof base === 'string' && BASE.test(base))) throw new Refusal('bad base');
    const root = path.resolve(opts['--root'] ?? process.cwd());
    let isDir = false;
    try {
      isDir = fs.statSync(root).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new Refusal('bad root');
    const a = { root, base, positional, handoff: null };
    if (opts['--handoff'] !== undefined) {
      const abs = path.resolve(root, opts['--handoff']);
      const inside = path.relative(root, abs);
      if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside) || !isFile(abs)) throw new Refusal('bad handoff');
      a.handoff = abs;
    }
    const handlers = { run: a2 => cmdRun(a2, options), list: cmdList, slices: cmdSlices, drift: cmdDrift };
    return handlers[command](a);
  } catch (error) {
    if (error instanceof Refusal) return { code: error.code, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
